mod download;
mod error;
mod images;
mod processing;
mod profiles;
mod tags;

use std::sync::Arc;

use axum::{
    Router,
    extract::DefaultBodyLimit,
    routing::{delete, get, patch, post},
};
use object_store::{ObjectStore, aws::AmazonS3Builder};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower_http::{cors::CorsLayer, trace::TraceLayer};

#[derive(Clone)]
pub struct AppState {
    pool: PgPool,
    store: Arc<dyn ObjectStore>,
    media_base_url: String,
}

async fn health() -> &'static str {
    "ok"
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "api=info,tower_http=info".into()),
        )
        .init();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://imgtagr:imgtagr@localhost:5432/imgtagr".into());

    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    sqlx::migrate!().run(&pool).await?;

    let store: Arc<dyn ObjectStore> = Arc::new(AmazonS3Builder::from_env().build()?);

    let media_base_url = std::env::var("MEDIA_BASE_URL").unwrap_or_else(|_| "/media".into());

    let state = AppState {
        pool,
        store,
        media_base_url: media_base_url.trim_end_matches('/').to_string(),
    };

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/profiles", get(profiles::list).post(profiles::create))
        .route("/api/profiles/{id}/login", post(profiles::login))
        .route(
            "/api/session",
            get(profiles::current).delete(profiles::logout),
        )
        .route(
            "/api/images",
            get(images::list)
                .post(images::upload)
                .layer(DefaultBodyLimit::max(images::MAX_UPLOAD_BYTES)),
        )
        .route("/api/images/stats", get(images::stats))
        .route("/api/images/delete", post(images::delete))
        .route("/api/images/download", post(download::download))
        .route("/api/images/tags", post(tags::add_to_images))
        .route("/api/images/{id}/tags", post(tags::add_to_image))
        .route(
            "/api/images/{id}/tags/{tag_id}",
            delete(tags::remove_from_image),
        )
        .route("/api/tags", get(tags::list))
        .route("/api/tags/{id}", patch(tags::update).delete(tags::delete))
        .route("/api/tags/{id}/merge", post(tags::merge))
        .route("/api/tags/{id}/download", post(download::download_tag))
        .layer(CorsLayer::permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let port = std::env::var("API_PORT").unwrap_or_else(|_| "3000".into());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on {addr}");
    axum::serve(listener, app).await?;

    Ok(())
}
