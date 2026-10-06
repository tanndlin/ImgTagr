# Packages the dist/ built by Jenkins' "Install & Build Frontend" stage
# instead of rebuilding. For local builds use `Dockerfile`.
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY dist /usr/share/nginx/html
EXPOSE 80
