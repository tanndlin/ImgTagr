use axum::{
    Json,
    extract::{Multipart, Query, State},
    http::StatusCode,
};
use bytes::Bytes;
use chrono::{DateTime, Utc};
use futures_util::{StreamExt, stream};
use object_store::{
    Attribute, Attributes, ObjectStore, ObjectStoreExt, PutOptions, PutPayload, path::Path,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{
    AppState,
    error::ApiError,
    processing::{self, ProcessError},
    tags::{self, TagDto},
};

pub const MAX_UPLOAD_BYTES: usize = 25 * 1024 * 1024;
const MAX_DELETE_IMAGES: usize = 500;

const SELECT_COLUMNS: &str = "id, storage_key, thumbnail_key, original_filename, content_type, \
                              size_bytes, width, height, created_at";

#[derive(sqlx::FromRow)]
struct ImageRow {
    id: Uuid,
    storage_key: String,
    thumbnail_key: String,
    original_filename: Option<String>,
    content_type: String,
    size_bytes: i64,
    width: i32,
    height: i32,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
pub struct ImageDto {
    id: Uuid,
    url: String,
    thumbnail_url: String,
    original_filename: Option<String>,
    content_type: String,
    size_bytes: i64,
    width: i32,
    height: i32,
    created_at: DateTime<Utc>,
    tags: Vec<TagDto>,
}

#[derive(Deserialize)]
pub struct DeleteImages {
    image_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub struct ListParams {
    tags: Option<String>,
}

impl ImageDto {
    fn from_row(row: ImageRow, media_base_url: &str, tags: Vec<TagDto>) -> Self {
        Self {
            id: row.id,
            url: format!("{media_base_url}/{}", row.storage_key),
            thumbnail_url: format!("{media_base_url}/{}", row.thumbnail_key),
            original_filename: row.original_filename,
            content_type: row.content_type,
            size_bytes: row.size_bytes,
            width: row.width,
            height: row.height,
            created_at: row.created_at,
            tags,
        }
    }
}

async fn to_dtos(state: &AppState, rows: Vec<ImageRow>) -> Result<Vec<ImageDto>, ApiError> {
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let mut tags_by_image = tags::for_images(&state.pool, &ids).await?;
    Ok(rows
        .into_iter()
        .map(|row| {
            let tags = tags_by_image.remove(&row.id).unwrap_or_default();
            ImageDto::from_row(row, &state.media_base_url, tags)
        })
        .collect())
}

/// Parses comma-separated ids, deduplicated so counts can be compared against them.
pub fn parse_ids(csv: &str, kind: &str) -> Result<Vec<Uuid>, ApiError> {
    let mut ids = csv
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            Uuid::parse_str(s).map_err(|_| ApiError::bad_request(format!("invalid {kind} id: {s}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    ids.sort_unstable();
    ids.dedup();
    Ok(ids)
}

/// `?tags=a,b` returns only images that have all of the given tags.
pub async fn list(
    State(state): State<AppState>,
    Query(params): Query<ListParams>,
) -> Result<Json<Vec<ImageDto>>, ApiError> {
    let tag_ids = parse_ids(params.tags.as_deref().unwrap_or_default(), "tag")?;
    let rows: Vec<ImageRow> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM images
         WHERE cardinality($1::uuid[]) = 0
            OR id IN (SELECT image_id FROM image_tags WHERE tag_id = ANY($1)
                      GROUP BY image_id HAVING count(*) = cardinality($1))
         ORDER BY created_at DESC LIMIT 200"
    ))
    .bind(&tag_ids)
    .fetch_all(&state.pool)
    .await?;

    Ok(Json(to_dtos(&state, rows).await?))
}

/// 201 for a new image, 200 with the existing one for a duplicate.
pub async fn upload(
    State(state): State<AppState>,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<ImageDto>), ApiError> {
    let (filename, data) = loop {
        let Some(field) = multipart.next_field().await? else {
            return Err(ApiError::bad_request("missing multipart field `file`"));
        };
        if field.name() == Some("file") {
            let filename = field.file_name().map(str::to_owned);
            break (filename, field.bytes().await?);
        }
    };
    if data.is_empty() {
        return Err(ApiError::bad_request("file is empty"));
    }

    let sha256 = hex::encode(Sha256::digest(&data));
    if let Some(existing) = find_by_sha(&state, &sha256).await? {
        return Ok((StatusCode::OK, Json(existing)));
    }

    let processed = tokio::task::spawn_blocking(move || processing::process(data))
        .await
        .map_err(|e| ApiError::Internal(format!("processing task failed: {e}")))?
        .map_err(|e| match e {
            ProcessError::Unsupported => {
                ApiError::bad_request("unsupported file type; upload a JPEG, PNG, WebP or GIF")
            }
            ProcessError::Invalid(msg) => ApiError::bad_request(format!("invalid image: {msg}")),
            ProcessError::Encode(msg) => ApiError::Internal(format!("encoding image: {msg}")),
        })?;

    let content_type = processed.format.to_mime_type();
    let ext = processed.format.extensions_str()[0];
    let storage_key = format!("images/{sha256}.{ext}");
    let thumbnail_key = format!("thumbnails/{sha256}.jpg");
    let size_bytes = processed.original.len() as i64;

    put(
        state.store.as_ref(),
        &storage_key,
        processed.original,
        content_type,
    )
    .await?;
    put(
        state.store.as_ref(),
        &thumbnail_key,
        processed.thumbnail,
        "image/jpeg",
    )
    .await?;

    // A concurrent upload of the same file may have won the insert.
    let inserted: Option<ImageRow> = sqlx::query_as(&format!(
        "INSERT INTO images (sha256, storage_key, thumbnail_key, original_filename, content_type, \
                             size_bytes, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (sha256) DO NOTHING
         RETURNING {SELECT_COLUMNS}"
    ))
    .bind(&sha256)
    .bind(&storage_key)
    .bind(&thumbnail_key)
    .bind(&filename)
    .bind(content_type)
    .bind(size_bytes)
    .bind(processed.width as i32)
    .bind(processed.height as i32)
    .fetch_optional(&state.pool)
    .await?;

    match inserted {
        Some(row) => Ok((
            StatusCode::CREATED,
            Json(ImageDto::from_row(row, &state.media_base_url, Vec::new())),
        )),
        None => {
            let existing = find_by_sha(&state, &sha256)
                .await?
                .ok_or_else(|| ApiError::Internal("image missing after insert conflict".into()))?;
            Ok((StatusCode::OK, Json(existing)))
        }
    }
}

/// Rows go first so a failed object delete leaves orphaned files rather than broken images.
pub async fn delete(
    State(state): State<AppState>,
    Json(body): Json<DeleteImages>,
) -> Result<StatusCode, ApiError> {
    if body.image_ids.is_empty() {
        return Err(ApiError::bad_request("image_ids must not be empty"));
    }
    if body.image_ids.len() > MAX_DELETE_IMAGES {
        return Err(ApiError::bad_request(format!(
            "at most {MAX_DELETE_IMAGES} images can be deleted at once"
        )));
    }

    let keys: Vec<(String, String)> = sqlx::query_as(
        "DELETE FROM images WHERE id = ANY($1) RETURNING storage_key, thumbnail_key",
    )
    .bind(&body.image_ids)
    .fetch_all(&state.pool)
    .await?;

    let store = state.store.as_ref();
    stream::iter(
        keys.into_iter()
            .flat_map(|(original, thumbnail)| [original, thumbnail]),
    )
    .for_each_concurrent(8, |key| async move {
        if let Err(err) = store.delete(&Path::from(key.as_str())).await {
            tracing::warn!("failed to delete {key}: {err}");
        }
    })
    .await;

    Ok(StatusCode::NO_CONTENT)
}

async fn find_by_sha(state: &AppState, sha256: &str) -> Result<Option<ImageDto>, ApiError> {
    let row: Option<ImageRow> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM images WHERE sha256 = $1"
    ))
    .bind(sha256)
    .fetch_optional(&state.pool)
    .await?;
    Ok(to_dtos(state, Vec::from_iter(row)).await?.pop())
}

async fn put(
    store: &dyn ObjectStore,
    key: &str,
    data: Bytes,
    content_type: &'static str,
) -> Result<(), ApiError> {
    let options = PutOptions {
        attributes: Attributes::from_iter([(Attribute::ContentType, content_type)]),
        ..Default::default()
    };
    store
        .put_opts(&Path::from(key), PutPayload::from(data), options)
        .await?;
    Ok(())
}
