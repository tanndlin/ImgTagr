use std::{collections::HashSet, io, sync::Arc};

use async_zip::{Compression, ZipDateTime, ZipEntryBuilder, tokio::write::ZipFileWriter};
use axum::{
    Form,
    body::Body,
    extract::State,
    http::header,
    response::{IntoResponse, Response},
};
use chrono::{DateTime, Utc};
use futures_util::{StreamExt, stream};
use object_store::{ObjectStore, ObjectStoreExt, path::Path};
use serde::Deserialize;
use tokio::{io::DuplexStream, sync::oneshot};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::{AppState, error::ApiError, images::parse_ids, profiles::Profile};

const MAX_DOWNLOAD_IMAGES: usize = 500;

type BoxError = Box<dyn std::error::Error + Send + Sync>;

#[derive(Deserialize)]
pub struct DownloadForm {
    ids: String,
}

#[derive(sqlx::FromRow)]
struct DownloadRow {
    id: Uuid,
    storage_key: String,
    original_filename: Option<String>,
    content_type: String,
    created_at: DateTime<Utc>,
}

struct Entry {
    name: String,
    key: String,
    created_at: DateTime<Utc>,
}

/// One image downloads as itself; several download as a zip.
pub async fn download(
    State(state): State<AppState>,
    profile: Profile,
    Form(form): Form<DownloadForm>,
) -> Result<Response, ApiError> {
    let ids = parse_ids(&form.ids, "image")?;
    if ids.is_empty() {
        return Err(ApiError::bad_request("ids must not be empty"));
    }
    if ids.len() > MAX_DOWNLOAD_IMAGES {
        return Err(ApiError::bad_request(format!(
            "at most {MAX_DOWNLOAD_IMAGES} images can be downloaded at once"
        )));
    }

    let rows: Vec<DownloadRow> = sqlx::query_as(
        "SELECT id, storage_key, original_filename, content_type, created_at
         FROM images WHERE id = ANY($1) AND profile_id = $2 ORDER BY created_at DESC",
    )
    .bind(&ids)
    .bind(profile.id)
    .fetch_all(&state.pool)
    .await?;
    if rows.len() != ids.len() {
        return Err(ApiError::not_found("image not found"));
    }

    if let [row] = rows.as_slice() {
        let name = file_name(row);
        let object = state
            .store
            .get(&Path::from(row.storage_key.as_str()))
            .await?;
        return Ok((
            [
                (header::CONTENT_TYPE, row.content_type.clone()),
                (header::CONTENT_DISPOSITION, attachment(&name)),
            ],
            Body::from_stream(object.into_stream()),
        )
            .into_response());
    }

    let mut taken = HashSet::new();
    let entries = rows
        .iter()
        .map(|row| Entry {
            name: unique_name(file_name(row), &mut taken),
            key: row.storage_key.clone(),
            created_at: row.created_at,
        })
        .collect();

    let (writer, reader) = tokio::io::duplex(64 * 1024);
    let (result_tx, result_rx) = oneshot::channel();
    let store = state.store.clone();
    tokio::spawn(async move {
        let _ = result_tx.send(write_zip(store, entries, writer).await);
    });

    // Ending the body with an error aborts the download instead of leaving a truncated zip.
    let outcome = stream::once(result_rx).filter_map(|result| async move {
        let err = match result {
            Ok(Ok(())) => return None,
            Ok(Err(err)) => err,
            Err(_) => "zip task ended without a result".into(),
        };
        tracing::error!("building zip: {err}");
        Some(Err(io::Error::other(err)))
    });

    Ok((
        [
            (header::CONTENT_TYPE, "application/zip".to_string()),
            (
                header::CONTENT_DISPOSITION,
                attachment("imgtagr-images.zip"),
            ),
        ],
        Body::from_stream(ReaderStream::new(reader).chain(outcome)),
    )
        .into_response())
}

async fn write_zip(
    store: Arc<dyn ObjectStore>,
    entries: Vec<Entry>,
    writer: DuplexStream,
) -> Result<(), BoxError> {
    let mut zip = ZipFileWriter::with_tokio(writer);
    for entry in entries {
        let data = store.get(&Path::from(entry.key)).await?.bytes().await?;
        // Images are already compressed, so storing them is as small and much faster.
        let builder = ZipEntryBuilder::new(entry.name.into(), Compression::Stored)
            .last_modification_date(ZipDateTime::from_chrono(&entry.created_at));
        zip.write_entry_whole(builder, &data).await?;
    }
    zip.close().await?;
    Ok(())
}

fn file_name(row: &DownloadRow) -> String {
    let original = row
        .original_filename
        .as_deref()
        .and_then(|name| name.rsplit(['/', '\\']).next())
        .map(|name| name.chars().filter(|c| !c.is_control()).collect::<String>())
        .filter(|name| !name.trim_matches('.').is_empty());
    original.unwrap_or_else(|| {
        let ext = row.storage_key.rsplit_once('.').map_or("", |(_, ext)| ext);
        format!("{}.{ext}", row.id)
    })
}

/// Appends " (2)", " (3)"… before the extension; case-insensitive so zips extract cleanly on Windows.
fn unique_name(name: String, taken: &mut HashSet<String>) -> String {
    if taken.insert(name.to_lowercase()) {
        return name;
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name.as_str(), String::new()),
    };
    (2..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|candidate| taken.insert(candidate.to_lowercase()))
        .expect("an unused name exists")
}

fn attachment(name: &str) -> String {
    let fallback: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && c != '"' && c != '\\' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let encoded: String = name
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                (b as char).to_string()
            }
            _ => format!("%{b:02X}"),
        })
        .collect();
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
}
