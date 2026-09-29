# ImgTagr

Vite + React frontend, Axum/SQLx API, Postgres, and S3-compatible storage for images ([RustFS](https://github.com/rustfs/rustfs) locally).

## Configuration

Copy `.env.example` to `.env` in the repo root. `DB_PORT`, `API_PORT`, `FRONTEND_PORT`, `S3_PORT` and `S3_CONSOLE_PORT` set the local ports; change them to avoid clashes with other services. The `AWS_*` values point the API at object storage; swap them for real S3/R2 credentials in production and set `MEDIA_BASE_URL` to the bucket's public URL or CDN.

## Run with Docker

```sh
docker compose up --build
```

- Frontend: http://localhost:8080
- API: http://localhost:$API_PORT/api/images
- Storage console: http://localhost:$S3_CONSOLE_PORT

## Local development

```sh
docker compose up -d --wait db s3   # Postgres + object storage
docker compose run --rm s3-init     # create the bucket (idempotent)
cd api && cargo watch -x run     # API on $API_PORT, reads the root .env
cd frontend && npm install && npm run dev   # Vite on $FRONTEND_PORT, proxies /api to the API
```

In VS Code, the [Restore Terminals](https://marketplace.visualstudio.com/items?itemName=EthanSK.restore-terminals) extension uses `.vscode/settings.json` to open split `api` and `frontend` terminals running the commands above on startup. Before starting, it stops the Docker `api` and `frontend` containers so they don't hold the API port.
