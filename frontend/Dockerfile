# NetChain frontend — Vite build with the box's public endpoints baked in
# (import.meta.env is COMPILE-TIME — rebuilding is required when PUBLIC_IP
# changes), served by nginx with the same-origin proxies the Vite dev server
# used to provide (see nginx.conf).
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_GATEWAY_URL=http://127.0.0.1:8082
ARG VITE_TRUST_URL=http://127.0.0.1:8200
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
ENV VITE_TRUST_URL=$VITE_TRUST_URL

# runs `tsc && vite build` → dist/
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
