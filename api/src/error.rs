use axum::{
    Json,
    extract::multipart::MultipartError,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

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
