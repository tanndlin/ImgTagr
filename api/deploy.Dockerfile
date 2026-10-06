# Packages the binary built by Jenkins' "Build Backend" stage (rust:latest, Debian trixie)
# instead of recompiling. For local builds use `Dockerfile`.
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY target/release/api /usr/local/bin/api
EXPOSE 3000
CMD ["api"]
