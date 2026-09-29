# ImgTagr

Hello world stack: Vite + React frontend, Axum/SQLx API, Postgres.

## Configuration

Copy `.env.example` to `.env` in the repo root. `DB_PORT` sets the host port Postgres is exposed on, `API_PORT` the API port, and `FRONTEND_PORT` the Vite dev server port. Change them to avoid clashes with other local services.

## Run with Docker

```sh
docker compose up --build
```

- Frontend: http://localhost:8080
- API: http://localhost:$API_PORT/api/hello

## Local development

```sh
docker compose up -d --wait db   # start Postgres only
cd api && cargo watch -x run     # API on $API_PORT, reads the root .env
cd frontend && npm install && npm run dev   # Vite on $FRONTEND_PORT, proxies /api to the API
```

In VS Code, the [Restore Terminals](https://marketplace.visualstudio.com/items?itemName=EthanSK.restore-terminals) extension uses `.vscode/settings.json` to open split `api` and `frontend` terminals running the commands above on startup. Before starting, it stops the Docker `api` and `frontend` containers so they don't hold the API port.
