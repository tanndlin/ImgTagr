use std::collections::HashMap;

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{AppState, error::ApiError};

const MAX_NAME_CHARS: usize = 64;

#[derive(Serialize, sqlx::FromRow)]
pub struct TagDto {
    id: Uuid,
    name: String,
    color: String,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct TagSummary {
    id: Uuid,
    name: String,
    color: String,
    image_count: i64,
}

#[derive(Deserialize)]
pub struct TagName {
    name: String,
}

#[derive(Deserialize)]
pub struct TagUpdate {
    name: Option<String>,
    color: Option<String>,
}

#[derive(sqlx::FromRow)]
struct ImageTagRow {
    image_id: Uuid,
    id: Uuid,
    name: String,
    color: String,
}

fn normalize_name(raw: &str) -> Result<String, ApiError> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(ApiError::bad_request("tag name must not be empty"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(ApiError::bad_request(format!(
            "tag name must be at most {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name)
}

fn normalize_color(raw: &str) -> Result<String, ApiError> {
    let color = raw.trim().to_ascii_lowercase();
    let valid = color.len() == 7
        && color.starts_with('#')
        && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    if !valid {
        return Err(ApiError::bad_request(
            "tag color must be a hex color like #a1b2c3",
        ));
    }
    Ok(color)
}

/// Tags for each of `image_ids`, sorted by lower(name).
pub async fn for_images(
    pool: &PgPool,
    image_ids: &[Uuid],
) -> Result<HashMap<Uuid, Vec<TagDto>>, ApiError> {
    let rows: Vec<ImageTagRow> = sqlx::query_as(
        "SELECT it.image_id, t.id, t.name, t.color
         FROM image_tags it JOIN tags t ON t.id = it.tag_id
         WHERE it.image_id = ANY($1)
         ORDER BY lower(t.name)",
    )
    .bind(image_ids)
    .fetch_all(pool)
    .await?;

    let mut by_image: HashMap<Uuid, Vec<TagDto>> = HashMap::new();
    for row in rows {
        by_image.entry(row.image_id).or_default().push(TagDto {
            id: row.id,
            name: row.name,
            color: row.color,
        });
    }
    Ok(by_image)
}

pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<TagSummary>>, ApiError> {
    let tags = sqlx::query_as(
        "SELECT t.id, t.name, t.color, count(it.image_id) AS image_count
         FROM tags t LEFT JOIN image_tags it ON it.tag_id = t.id
         GROUP BY t.id
         ORDER BY lower(t.name)",
    )
    .fetch_all(&state.pool)
    .await?;
    Ok(Json(tags))
}

#[derive(Deserialize)]
pub struct BulkTag {
    image_ids: Vec<Uuid>,
    name: String,
}

pub async fn add_to_image(
    State(state): State<AppState>,
    Path(image_id): Path<Uuid>,
    Json(body): Json<TagName>,
) -> Result<Json<TagDto>, ApiError> {
    tag_images(&state.pool, &[image_id], &body.name)
        .await
        .map(Json)
}

pub async fn add_to_images(
    State(state): State<AppState>,
    Json(body): Json<BulkTag>,
) -> Result<Json<TagDto>, ApiError> {
    if body.image_ids.is_empty() {
        return Err(ApiError::bad_request("image_ids must not be empty"));
    }
    tag_images(&state.pool, &body.image_ids, &body.name)
        .await
        .map(Json)
}

async fn tag_images(pool: &PgPool, image_ids: &[Uuid], raw_name: &str) -> Result<TagDto, ApiError> {
    let name = normalize_name(raw_name)?;
    let mut tx = pool.begin().await?;

    let tag: TagDto = sqlx::query_as(
        "INSERT INTO tags (name) VALUES ($1)
         ON CONFLICT ((lower(name))) DO UPDATE SET name = tags.name
         RETURNING id, name, color",
    )
    .bind(&name)
    .fetch_one(&mut *tx)
    .await?;

    sqlx::query(
        "INSERT INTO image_tags (image_id, tag_id)
         SELECT DISTINCT unnest($1::uuid[]), $2
         ON CONFLICT DO NOTHING",
    )
    .bind(image_ids)
    .bind(tag.id)
    .execute(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_foreign_key_violation() => {
            ApiError::not_found("image not found")
        }
        e => e.into(),
    })?;

    tx.commit().await?;
    Ok(tag)
}

pub async fn remove_from_image(
    State(state): State<AppState>,
    Path((image_id, tag_id)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    sqlx::query("DELETE FROM image_tags WHERE image_id = $1 AND tag_id = $2")
        .bind(image_id)
        .bind(tag_id)
        .execute(&state.pool)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn update(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<TagUpdate>,
) -> Result<Json<TagDto>, ApiError> {
    let name = body.name.as_deref().map(normalize_name).transpose()?;
    let color = body.color.as_deref().map(normalize_color).transpose()?;
    let tag: Option<TagDto> = sqlx::query_as(
        "UPDATE tags SET name = COALESCE($1, name), color = COALESCE($2, color)
         WHERE id = $3 RETURNING id, name, color",
    )
    .bind(&name)
    .bind(&color)
    .bind(id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_unique_violation() => ApiError::conflict(format!(
            "a tag named \"{}\" already exists",
            name.as_deref().unwrap_or_default()
        )),
        e => e.into(),
    })?;
    tag.map(Json)
        .ok_or_else(|| ApiError::not_found("tag not found"))
}

pub async fn delete(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let result = sqlx::query("DELETE FROM tags WHERE id = $1")
        .bind(id)
        .execute(&state.pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(ApiError::not_found("tag not found"));
    }
    Ok(StatusCode::NO_CONTENT)
}
