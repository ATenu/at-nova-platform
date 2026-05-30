# syntax=docker/dockerfile:1

# ---- Build stage: compile the Vite app to static assets ----
FROM node:22-alpine AS build
WORKDIR /app

# Install dependencies against the committed lockfile for reproducible builds.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_* values are inlined at build time. Defaults assume the browser reaches
# the API and Keycloak on the host via localhost; override per environment.
ARG VITE_API_BASE_URL=http://localhost:3000/api/v1
ARG VITE_KEYCLOAK_URL=http://localhost:8080
ARG VITE_KEYCLOAK_REALM=nova
ARG VITE_KEYCLOAK_CLIENT_ID=nova-frontend
ARG VITE_APP_NAME=Nova
# Never enable mocks in a built image.
ARG VITE_USE_MOCKS=false
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_KEYCLOAK_URL=$VITE_KEYCLOAK_URL \
    VITE_KEYCLOAK_REALM=$VITE_KEYCLOAK_REALM \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_APP_NAME=$VITE_APP_NAME \
    VITE_USE_MOCKS=$VITE_USE_MOCKS

RUN npm run build

# ---- Runtime stage: serve static assets with nginx ----
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
CMD ["nginx", "-g", "daemon off;"]
