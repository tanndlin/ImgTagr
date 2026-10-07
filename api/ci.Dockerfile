# Toolchain image for Jenkins: rust images don't ship clippy or rustfmt,
# so bake them in once instead of downloading them on every build.
FROM rust:1.97
RUN rustup component add clippy rustfmt
