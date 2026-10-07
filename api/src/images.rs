use axum::{
    Json,
    extract::{Multipart, Path as UrlPath, Query, State},
    http::StatusCode,
};
use bytes::Bytes;
use chrono::{DateTime, SecondsFormat, Utc};
use futures_util::{StreamExt, stream};
use object_store::{
    Attribute, Attributes, ObjectStore, ObjectStoreExt, PutOptions, PutPayload, path::Path,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

use crate::{
    AppState,
    error::ApiError,
    input::{limit_images, parse_ids, require_ids},
    processing,
    profiles::Profile,
    tags::{self, TagDto},
};

pub const MAX_UPLOAD_BYTES: usize = 100 * 1024 * 1024;
const MAX_DELETE_IMAGES: usize = 500;
const DEFAULT_PAGE_SIZE: i64 = 100;
const MAX_PAGE_SIZE: i64 = 200;
const MAX_FILENAME_CHARS: usize = 255;

const SELECT_COLUMNS: &str = "id, storage_key, thumbnail_key, original_filename, content_type, \
                              size_bytes, width, height, created_at, taken_at";

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
    taken_at: Option<DateTime<Utc>>,
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
    taken_at: Option<DateTime<Utc>>,
    tags: Vec<TagDto>,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct Stats {
    image_count: i64,
    total_bytes: i64,
    untagged_count: i64,
}

#[derive(Deserialize)]
pub struct DeleteImages {
    image_ids: Vec<Uuid>,
}

#[derive(Deserialize)]
pub struct ImageUpdate {
    original_filename: String,
}

#[derive(Deserialize, Clone, Copy, Default)]
#[serde(rename_all = "snake_case")]
pub enum Sort {
    #[default]
    Newest,
    Oldest,
    NameAsc,
    NameDesc,
    Largest,
    Smallest,
    TakenNewest,
    TakenOldest,
}

impl Sort {
    /// The ordering key over `images`, and how a bound cursor value is turned into the same key.
    fn key(self) -> (&'static str, (&'static str, &'static str)) {
        match self {
            Self::Newest | Self::Oldest => ("created_at", ("", "::timestamptz")),
            Self::NameAsc | Self::NameDesc => {
                ("lower(coalesce(original_filename, ''))", ("lower(", ")"))
            }
            Self::Largest | Self::Smallest => ("size_bytes", ("", "::bigint")),
            Self::TakenNewest | Self::TakenOldest => {
                ("coalesce(taken_at, created_at)", ("", "::timestamptz"))
            }
        }
    }

    fn descending(self) -> bool {
        matches!(
            self,
            Self::Newest | Self::NameDesc | Self::Largest | Self::TakenNewest
        )
    }

    /// Where the next page starts after `row`, as "<id>:<sort value>". Clients pass it back as is.
    fn cursor(self, row: &ImageRow) -> String {
        let time = |t: DateTime<Utc>| t.to_rfc3339_opts(SecondsFormat::AutoSi, true);
        let value = match self {
            Self::Newest | Self::Oldest => time(row.created_at),
            Self::NameAsc | Self::NameDesc => row.original_filename.clone().unwrap_or_default(),
            Self::Largest | Self::Smallest => row.size_bytes.to_string(),
            Self::TakenNewest | Self::TakenOldest => time(row.taken_at.unwrap_or(row.created_at)),
        };
        format!("{}:{value}", row.id)
    }

    /// The id and sort value of a cursor from `cursor`, if it fits this sort.
    fn parse_cursor(self, cursor: &str) -> Option<(Uuid, String)> {
        let (id, value) = cursor.split_once(':')?;
        let id = id.parse().ok()?;
        self.valid_cursor(value).then(|| (id, value.to_owned()))
    }

    fn valid_cursor(self, value: &str) -> bool {
        match self {
            Self::Newest | Self::Oldest | Self::TakenNewest | Self::TakenOldest => {
                value.parse::<DateTime<Utc>>().is_ok()
            }
            Self::NameAsc | Self::NameDesc => true,
            Self::Largest | Self::Smallest => value.parse::<i64>().is_ok(),
        }
    }
}

#[derive(Deserialize)]
pub struct ListParams {
    tags: Option<String>,
    q: Option<String>,
    untagged: Option<bool>,
    #[serde(default)]
    sort: Sort,
    after: Option<String>,
    limit: Option<i64>,
}

#[derive(Serialize)]
pub struct ImagePage {
    images: Vec<ImageDto>,
    /// Pass as `?after=` for the next page; absent on the last page.
    next: Option<String>,
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
            taken_at: row.taken_at,
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

fn contains_pattern(q: &str) -> String {
    let escaped = q
        .replace('\\', r"\\")
        .replace('%', r"\%")
        .replace('_', r"\_");
    format!("%{escaped}%")
}

/// `?tags=a,b` returns only images that have all of the given tags.
/// `?q=text` returns only images whose filename or a tag name contains the text.
/// `?untagged=true` returns only images without tags.
/// `?sort=newest|oldest|name_asc|name_desc|largest|smallest|taken_newest|taken_oldest` orders the
/// images, newest by default. Images without a taken time sort by their upload time.
/// `?after=<cursor>` returns the page after the one whose `next` it was.
pub async fn list(
    State(state): State<AppState>,
    profile: Profile,
    Query(params): Query<ListParams>,
) -> Result<Json<ImagePage>, ApiError> {
    let sort = params.sort;
    let cursor = params
        .after
        .map(|after| {
            sort.parse_cursor(&after)
                .ok_or_else(|| ApiError::bad_request(format!("invalid after cursor: {after}")))
        })
        .transpose()?;
    let limit = params
        .limit
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let tag_ids = parse_ids(params.tags.as_deref().unwrap_or_default(), "tag")?;
    let pattern = params
        .q
        .as_deref()
        .map(str::trim)
        .filter(|q| !q.is_empty())
        .map(contains_pattern);
    let (key, (cursor_open, cursor_close)) = sort.key();
    let (dir, cmp) = if sort.descending() {
        ("DESC", "<")
    } else {
        ("ASC", ">")
    };

    let mut query = QueryBuilder::<Postgres>::new(format!(
        "SELECT {SELECT_COLUMNS} FROM images WHERE profile_id = "
    ));
    query.push_bind(profile.id);
    if !tag_ids.is_empty() {
        let count = tag_ids.len() as i64;
        query
            .push(" AND id IN (SELECT image_id FROM image_tags WHERE tag_id = ANY(")
            .push_bind(tag_ids)
            .push(") GROUP BY image_id HAVING count(*) = ")
            .push_bind(count)
            .push(")");
    }
    if let Some(pattern) = pattern {
        query
            .push(" AND (original_filename ILIKE ")
            .push_bind(pattern.clone())
            .push(
                " OR EXISTS (SELECT 1 FROM image_tags it JOIN tags t ON t.id = it.tag_id \
                 WHERE it.image_id = images.id AND t.name ILIKE ",
            )
            .push_bind(pattern)
            .push("))");
    }
    if let Some((id, value)) = cursor {
        query
            .push(format!(" AND ({key}, id) {cmp} ({cursor_open}"))
            .push_bind(value)
            .push(format!("{cursor_close}, "))
            .push_bind(id)
            .push(")");
    }
    if params.untagged.unwrap_or_default() {
        query.push(" AND NOT EXISTS (SELECT 1 FROM image_tags WHERE image_id = images.id)");
    }
    query
        .push(format!(" ORDER BY {key} {dir}, id {dir} LIMIT "))
        .push_bind(limit + 1);
    let mut rows: Vec<ImageRow> = query.build_query_as().fetch_all(&state.pool).await?;

    // The extra row only shows whether another page exists.
    let next = (rows.len() as i64 > limit).then(|| {
        rows.truncate(limit as usize);
        rows.last().map(|row| sort.cursor(row))
    });
    Ok(Json(ImagePage {
        images: to_dtos(&state, rows).await?,
        next: next.flatten(),
    }))
}

pub async fn stats(
    State(state): State<AppState>,
    profile: Profile,
) -> Result<Json<Stats>, ApiError> {
    let stats = sqlx::query_as(
        "SELECT COUNT(*) AS image_count, COALESCE(SUM(size_bytes), 0)::BIGINT AS total_bytes,
                COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM image_tags WHERE image_id = images.id))
                    AS untagged_count
         FROM images WHERE profile_id = $1",
    )
    .bind(profile.id)
    .fetch_one(&state.pool)
    .await?;
    Ok(Json(stats))
}

/// 201 for a new image, 200 with the existing one for a duplicate.
pub async fn upload(
    State(state): State<AppState>,
    profile: Profile,
    mut multipart: Multipart,
) -> Result<(StatusCode, Json<ImageDto>), ApiError> {
    let mut file = None;
    let mut max_size = None;
    while let Some(field) = multipart.next_field().await? {
        match field.name() {
            Some("file") => {
                let filename = field.file_name().map(str::to_owned);
                file = Some((filename, field.bytes().await?));
            }
            Some("max_size") => {
                let size = field.text().await?.parse::<u32>().ok().filter(|&n| n > 0);
                max_size =
                    Some(size.ok_or_else(|| {
                        ApiError::bad_request("max_size must be a positive integer")
                    })?);
            }
            _ => {}
        }
    }

    let Some((filename, data)) = file else {
        return Err(ApiError::bad_request("missing multipart field `file`"));
    };
    if data.is_empty() {
        return Err(ApiError::bad_request("file is empty"));
    }

    let sha256 = hex::encode(Sha256::digest(&data));
    if let Some(existing) = find_by_sha(&state, profile.id, &sha256).await? {
        return Ok((StatusCode::OK, Json(existing)));
    }

    let processed =
        tokio::task::spawn_blocking(move || processing::process(data, max_size)).await??;

    // Resized files differ from the upload, so key them by their own content.
    let sha256 = if processed.resized {
        hex::encode(Sha256::digest(&processed.original))
    } else {
        sha256
    };
    let content_type = processed.format.to_mime_type();
    let ext = processed.format.extensions_str()[0];
    let storage_key = format!("images/{sha256}.{ext}");
    let thumbnail_key = format!("thumbnails/{sha256}.jpg");
    let size_bytes = processed.original.len() as i64;

    tokio::try_join!(
        put(
            state.store.as_ref(),
            &storage_key,
            processed.original,
            content_type,
        ),
        put(
            state.store.as_ref(),
            &thumbnail_key,
            processed.thumbnail,
            "image/jpeg",
        ),
    )?;

    // A concurrent upload of the same file may have won the insert.
    let inserted: Option<ImageRow> = sqlx::query_as(&format!(
        "INSERT INTO images (sha256, storage_key, thumbnail_key, original_filename, content_type, \
                             size_bytes, width, height, profile_id, taken_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (profile_id, sha256) DO NOTHING
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
    .bind(profile.id)
    .bind(processed.taken_at)
    .fetch_optional(&state.pool)
    .await?;

    match inserted {
        Some(row) => Ok((
            StatusCode::CREATED,
            Json(ImageDto::from_row(row, &state.media_base_url, Vec::new())),
        )),
        None => {
            let existing = find_by_sha(&state, profile.id, &sha256)
                .await?
                .ok_or_else(|| ApiError::Internal("image missing after insert conflict".into()))?;
            Ok((StatusCode::OK, Json(existing)))
        }
    }
}

fn normalize_filename(raw: &str) -> Result<String, ApiError> {
    let name = raw.trim();
    if name.trim_matches('.').is_empty() {
        return Err(ApiError::bad_request("filename must not be empty"));
    }
    if name
        .chars()
        .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(ApiError::bad_request("filename can't contain slashes"));
    }
    if name.chars().count() > MAX_FILENAME_CHARS {
        return Err(ApiError::bad_request(format!(
            "filename must be at most {MAX_FILENAME_CHARS} characters"
        )));
    }
    Ok(name.to_owned())
}

pub async fn update(
    State(state): State<AppState>,
    profile: Profile,
    UrlPath(id): UrlPath<Uuid>,
    Json(body): Json<ImageUpdate>,
) -> Result<Json<ImageDto>, ApiError> {
    let filename = normalize_filename(&body.original_filename)?;
    let row: Option<ImageRow> = sqlx::query_as(&format!(
        "UPDATE images SET original_filename = $1 WHERE id = $2 AND profile_id = $3
         RETURNING {SELECT_COLUMNS}"
    ))
    .bind(&filename)
    .bind(id)
    .bind(profile.id)
    .fetch_optional(&state.pool)
    .await?;
    let row = row.ok_or_else(|| ApiError::not_found("image not found"))?;
    Ok(Json(to_dtos(&state, vec![row]).await?.remove(0)))
}

/// Rows go first so a failed object delete leaves orphaned files rather than broken images.
/// Files are shared by content, so only those no other profile still uses are deleted.
pub async fn delete(
    State(state): State<AppState>,
    profile: Profile,
    Json(body): Json<DeleteImages>,
) -> Result<StatusCode, ApiError> {
    require_ids(&body.image_ids, "image_ids")?;
    limit_images(&body.image_ids, MAX_DELETE_IMAGES, "deleted")?;

    let keys: Vec<(String, String)> = sqlx::query_as(
        "WITH deleted AS (
             DELETE FROM images WHERE id = ANY($1) AND profile_id = $2
             RETURNING sha256, storage_key, thumbnail_key
         )
         SELECT storage_key, thumbnail_key FROM deleted d
         WHERE NOT EXISTS (SELECT 1 FROM images i
                           WHERE i.sha256 = d.sha256 AND i.profile_id IS DISTINCT FROM $2)",
    )
    .bind(&body.image_ids)
    .bind(profile.id)
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

async fn find_by_sha(
    state: &AppState,
    profile_id: Uuid,
    sha256: &str,
) -> Result<Option<ImageDto>, ApiError> {
    let row: Option<ImageRow> = sqlx::query_as(&format!(
        "SELECT {SELECT_COLUMNS} FROM images WHERE profile_id = $1 AND sha256 = $2"
    ))
    .bind(profile_id)
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

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::{Sort, normalize_filename};

    #[test]
    fn cursor_must_match_sort_key() {
        assert!(Sort::Newest.valid_cursor("2026-09-29T12:00:00.123456Z"));
        assert!(!Sort::Oldest.valid_cursor("42"));
        assert!(Sort::Largest.valid_cursor("42"));
        assert!(!Sort::Smallest.valid_cursor("2026-09-29T12:00:00Z"));
        assert!(Sort::NameAsc.valid_cursor("anything"));
        assert!(Sort::TakenNewest.valid_cursor("2026-09-29T12:00:00Z"));
        assert!(!Sort::TakenOldest.valid_cursor("42"));
    }

    #[test]
    fn cursor_holds_id_then_value() {
        let id = Uuid::nil();
        let parsed = Sort::NameAsc.parse_cursor(&format!("{id}:a:b.jpg"));
        assert_eq!(parsed, Some((id, "a:b.jpg".to_owned())));
        assert_eq!(Sort::Largest.parse_cursor(&format!("{id}:x")), None);
        assert_eq!(Sort::Largest.parse_cursor("42"), None);
    }

    #[test]
    fn default_sort_is_newest_first() {
        assert!(matches!(Sort::default(), Sort::Newest));
        assert_eq!(Sort::default().key().0, "created_at");
        assert!(Sort::default().descending());
    }

    #[test]
    fn filename_is_trimmed_and_checked() {
        assert_eq!(
            normalize_filename("  cat.jpg ").ok().as_deref(),
            Some("cat.jpg")
        );
        assert!(normalize_filename(" .. ").is_err());
        assert!(normalize_filename("a/b.jpg").is_err());
        assert!(normalize_filename("a\\b.jpg").is_err());
    }
}
