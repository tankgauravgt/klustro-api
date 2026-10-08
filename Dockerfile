# Dev image: TypeScript runs directly through @swc-node/register, so dev dependencies stay in.
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# In-memory SQLite: the data is gone on every restart, which is what dev mode wants.
# Secrets and per-environment URLs come from the App Service settings, never from the image.
# App Service mounts /home from a shared volume, so SWC's native-binding cache goes under /tmp.
ENV DB_PATH=":memory:" \
    USE_SQLITE_DATABASE="1" \
    WEBSITES_PORT="8080" \
    SWC_NATIVE_BINDING_CACHE="/tmp/swc-native"
EXPOSE 8080

USER node
CMD ["node", "--import", "@swc-node/register/esm-register", "apps/app-gw/src/main.ts"]
