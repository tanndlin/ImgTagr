use axum::{
    Json,
    extract::multipart::MultipartError,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
use tokio::task::JoinError;

use crate::processing::ProcessError;

pub enum ApiError {
    Client(StatusCode, String),
    Internal(String),
}

impl ApiError {
    pub fn bad_request(msg: impl Into<String>) -> Self {
        Self::Client(StatusCode::BAD_REQUEST, msg.into())
    }

    pub fn unauthorized(msg: impl Into<String>) -> Self {
        Self::Client(StatusCode::UNAUTHORIZED, msg.into())
    }

    pub fn not_found(msg: impl Into<String>) -> Self {
        Self::Client(StatusCode::NOT_FOUND, msg.into())
    }

    pub fn conflict(msg: impl Into<String>) -> Self {
        Self::Client(StatusCode::CONFLICT, msg.into())
    }

    /// For `map_err`: a unique violation becomes a 409 with `msg`, anything else converts as usual.
    pub fn conflict_on_unique(msg: impl FnOnce() -> String) -> impl FnOnce(sqlx::Error) -> Self {
        |err| match err {
            sqlx::Error::Database(ref db) if db.is_unique_violation() => Self::conflict(msg()),
            err => err.into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            Self::Client(status, message) => (status, message),
            Self::Internal(err) => {
                tracing::error!("{err}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };
        (status, Json(json!({ "error": message }))).into_response()
    }
}

impl From<sqlx::Error> for ApiError {
    fn from(err: sqlx::Error) -> Self {
        Self::Internal(format!("database error: {err}"))
    }
}

impl From<object_store::Error> for ApiError {
    fn from(err: object_store::Error) -> Self {
        Self::Internal(format!("storage error: {err}"))
    }
}

impl From<MultipartError> for ApiError {
    fn from(err: MultipartError) -> Self {
        Self::Client(err.status(), err.body_text())
    }
}

impl From<JoinError> for ApiError {
    fn from(err: JoinError) -> Self {
        Self::Internal(format!("background task failed: {err}"))
    }
}

impl From<ProcessError> for ApiError {
    fn from(err: ProcessError) -> Self {
        match err {
            ProcessError::Unsupported => {
                Self::bad_request("unsupported file type; upload a JPEG, PNG, WebP or GIF")
            }
            ProcessError::Invalid(msg) => Self::bad_request(format!("invalid image: {msg}")),
            ProcessError::Encode(msg) => Self::Internal(format!("encoding image: {msg}")),
        }
    }
}
