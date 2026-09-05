# NetChain frontend — Vite build with the box's public endpoints baked in
# (import.meta.env is COMPILE-TIME — rebuilding is required when PUBLIC_IP
# changes), served by nginx with the same-origin proxies the Vite dev server
# used to provide (see nginx.conf).
#
# NOTE: the build context is the REPO ROOT (docker-compose.yml sets
# `context: .` + `dockerfile: frontend/Dockerfile`), because the app imports
# the scenario JSONs from the repo root (src/services/live.ts →
# ../../../scenarios/*.json). The layout below mirrors the repo so those
# relative imports resolve: /app/frontend/src/services → /app/scenarios.
FROM node:22-alpine AS build
WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
COPY scenarios /app/scenarios

ARG VITE_GATEWAY_URL=http://127.0.0.1:8082
ARG VITE_TRUST_URL=http://127.0.0.1:8200
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
ENV VITE_TRUST_URL=$VITE_TRUST_URL

# runs `tsc && vite build` → dist/
RUN npm run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 80
