use std::collections::HashSet;

use axum::{Json, extract::State};
use futures_util::TryStreamExt;
use serde::Serialize;

use crate::{AppState, error::ApiError, profiles::Profile};

#[derive(Serialize, sqlx::FromRow)]
pub struct Totals {
    profile_count: i64,
    active_session_count: i64,
    image_count: i64,
    unique_image_count: i64,
    logical_bytes: i64,
    stored_bytes: i64,
}

#[derive(Serialize, sqlx::FromRow)]
pub struct ProfileUsage {
    name: String,
    image_count: i64,
    tag_count: i64,
    total_bytes: i64,
}

#[derive(Serialize, Default)]
pub struct BucketUsage {
    object_count: u64,
    original_bytes: u64,
    thumbnail_bytes: u64,
    orphan_count: u64,
    orphan_bytes: u64,
}

#[derive(Serialize)]
pub struct InstanceStats {
    #[serde(flatten)]
    totals: Totals,
    bucket: BucketUsage,
    profiles: Vec<ProfileUsage>,
}

pub async fn instance(
    State(state): State<AppState>,
    _profile: Profile,
) -> Result<Json<InstanceStats>, ApiError> {
    let totals = sqlx::query_as(
        "SELECT (SELECT COUNT(*) FROM profiles) AS profile_count,
                (SELECT COUNT(*) FROM sessions WHERE expires_at > now()) AS active_session_count,
                (SELECT COUNT(*) FROM images) AS image_count,
                (SELECT COUNT(DISTINCT sha256) FROM images) AS unique_image_count,
                (SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM images) AS logical_bytes,
                (SELECT COALESCE(SUM(size_bytes), 0)::BIGINT
                 FROM (SELECT DISTINCT ON (sha256) size_bytes FROM images) s) AS stored_bytes",
    )
    .fetch_one(&state.pool)
    .await?;

    let profiles = sqlx::query_as(
        "SELECT p.name,
                (SELECT COUNT(*) FROM images WHERE profile_id = p.id) AS image_count,
                (SELECT COUNT(*) FROM tags WHERE profile_id = p.id) AS tag_count,
                (SELECT COALESCE(SUM(size_bytes), 0)::BIGINT FROM images WHERE profile_id = p.id)
                    AS total_bytes
         FROM profiles p
         ORDER BY total_bytes DESC, lower(p.name)",
    )
    .fetch_all(&state.pool)
    .await?;

    let known: HashSet<String> =
        sqlx::query_scalar("SELECT storage_key FROM images UNION SELECT thumbnail_key FROM images")
            .fetch_all(&state.pool)
            .await?
            .into_iter()
            .collect();

    let bucket = state
        .store
        .list(None)
        .try_fold(BucketUsage::default(), |mut usage, meta| {
            let key = meta.location.as_ref();
            usage.object_count += 1;
            if !known.contains(key) {
                usage.orphan_count += 1;
                usage.orphan_bytes += meta.size;
            } else if key.starts_with("thumbnails/") {
                usage.thumbnail_bytes += meta.size;
            } else {
                usage.original_bytes += meta.size;
            }

            async { Ok(usage) }
        })
        .await?;

    Ok(Json(InstanceStats {
        totals,
        bucket,
        profiles,
    }))
}
