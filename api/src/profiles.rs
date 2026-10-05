use argon2::{
    Argon2,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use axum::{
    Json,
    extract::{FromRequestParts, Path, State},
    http::{StatusCode, request::Parts},
};
use axum_extra::extract::{
    CookieJar,
    cookie::{Cookie, SameSite},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::{AppState, error::ApiError};

const COOKIE: &str = "imgtagr_session";
const SESSION_DAYS: i64 = 30;
const MAX_NAME_CHARS: usize = 32;
const MIN_PASSWORD_CHARS: usize = 4;

#[derive(Serialize, sqlx::FromRow, Clone)]
pub struct Profile {
    pub id: Uuid,
    pub name: String,
}

#[derive(Deserialize)]
pub struct NewProfile {
    name: String,
    password: String,
}

#[derive(Deserialize)]
pub struct Login {
    password: String,
}

fn token_hash(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

impl FromRequestParts<AppState> for Profile {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar
            .get(COOKIE)
            .ok_or_else(|| ApiError::unauthorized("not signed in"))?
            .value();
        sqlx::query_as(
            "SELECT p.id, p.name FROM sessions s JOIN profiles p ON p.id = s.profile_id
             WHERE s.token_hash = $1 AND s.expires_at > now()",
        )
        .bind(token_hash(token))
        .fetch_optional(&state.pool)
        .await?
        .ok_or_else(|| ApiError::unauthorized("not signed in"))
    }
}

fn normalize_name(raw: &str) -> Result<String, ApiError> {
    let name = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.is_empty() {
        return Err(ApiError::bad_request("profile name must not be empty"));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(ApiError::bad_request(format!(
            "profile name must be at most {MAX_NAME_CHARS} characters"
        )));
    }
    Ok(name)
}

async fn start_session(
    state: &AppState,
    jar: CookieJar,
    profile_id: Uuid,
) -> Result<CookieJar, ApiError> {
    let token = hex::encode(rand::random::<[u8; 32]>());
    sqlx::query(
        "INSERT INTO sessions (token_hash, profile_id, expires_at)
         VALUES ($1, $2, now() + make_interval(days => $3))",
    )
    .bind(token_hash(&token))
    .bind(profile_id)
    .bind(SESSION_DAYS as i32)
    .execute(&state.pool)
    .await?;
    let cookie = Cookie::build((COOKIE, token))
        .path("/")
        .http_only(true)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::days(SESSION_DAYS));
    Ok(jar.add(cookie))
}

async fn spawn_hash<T: Send + 'static>(
    f: impl FnOnce() -> T + Send + 'static,
) -> Result<T, ApiError> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| ApiError::Internal(format!("hashing task failed: {e}")))
}

pub async fn list(State(state): State<AppState>) -> Result<Json<Vec<Profile>>, ApiError> {
    let profiles = sqlx::query_as("SELECT id, name FROM profiles ORDER BY lower(name)")
        .fetch_all(&state.pool)
        .await?;
    Ok(Json(profiles))
}

pub async fn current(profile: Profile) -> Json<Profile> {
    Json(profile)
}

/// Creates a profile and signs in as it. Images and tags from before profiles existed go to it.
pub async fn create(
    State(state): State<AppState>,
    jar: CookieJar,
    Json(body): Json<NewProfile>,
) -> Result<(StatusCode, CookieJar, Json<Profile>), ApiError> {
    let name = normalize_name(&body.name)?;
    if body.password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(ApiError::bad_request(format!(
            "password must be at least {MIN_PASSWORD_CHARS} characters"
        )));
    }
    let password_hash = spawn_hash(move || {
        Argon2::default()
            .hash_password(body.password.as_bytes())
            .map(|hash| hash.to_string())
    })
    .await?
    .map_err(|e| ApiError::Internal(format!("hashing password: {e}")))?;

    let mut tx = state.pool.begin().await?;
    let profile: Profile = sqlx::query_as(
        "INSERT INTO profiles (name, password_hash) VALUES ($1, $2) RETURNING id, name",
    )
    .bind(&name)
    .bind(&password_hash)
    .fetch_one(&mut *tx)
    .await
    .map_err(|e| match e {
        sqlx::Error::Database(ref db) if db.is_unique_violation() => {
            ApiError::conflict(format!("a profile named \"{name}\" already exists"))
        }
        e => e.into(),
    })?;
    sqlx::query("UPDATE images SET profile_id = $1 WHERE profile_id IS NULL")
        .bind(profile.id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("UPDATE tags SET profile_id = $1 WHERE profile_id IS NULL")
        .bind(profile.id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    let jar = start_session(&state, jar, profile.id).await?;
    Ok((StatusCode::CREATED, jar, Json(profile)))
}

pub async fn login(
    State(state): State<AppState>,
    jar: CookieJar,
    Path(id): Path<Uuid>,
    Json(body): Json<Login>,
) -> Result<(CookieJar, Json<Profile>), ApiError> {
    let (name, password_hash): (String, String) =
        sqlx::query_as("SELECT name, password_hash FROM profiles WHERE id = $1")
            .bind(id)
            .fetch_optional(&state.pool)
            .await?
            .ok_or_else(|| ApiError::not_found("profile not found"))?;

    let valid = spawn_hash(move || {
        PasswordHash::new(&password_hash).is_ok_and(|hash| {
            Argon2::default()
                .verify_password(body.password.as_bytes(), &hash)
                .is_ok()
        })
    })
    .await?;
    if !valid {
        return Err(ApiError::unauthorized("wrong password"));
    }

    sqlx::query("DELETE FROM sessions WHERE expires_at <= now()")
        .execute(&state.pool)
        .await?;
    let jar = start_session(&state, jar, id).await?;
    Ok((jar, Json(Profile { id, name })))
}

pub async fn logout(
    State(state): State<AppState>,
    jar: CookieJar,
) -> Result<(CookieJar, StatusCode), ApiError> {
    if let Some(cookie) = jar.get(COOKIE) {
        sqlx::query("DELETE FROM sessions WHERE token_hash = $1")
            .bind(token_hash(cookie.value()))
            .execute(&state.pool)
            .await?;
    }
    Ok((
        jar.remove(Cookie::build(COOKIE).path("/")),
        StatusCode::NO_CONTENT,
    ))
}
