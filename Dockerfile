# Life Is in one image: the pages are built, then served by the same program as the API, on port 8008.
#   docker build -t lifeis .

FROM node:24-slim AS pages
WORKDIR /pages
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY frontend/ .
RUN npm run build

# The one thing the program needs installed: the encrypted database engine.
FROM node:24-slim AS engine
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:24-slim
WORKDIR /app/server
COPY --from=engine /app/server/node_modules ./node_modules
COPY core/src /app/core/src
COPY server/package.json ./
COPY server/src ./src
COPY --from=pages /pages/dist /app/pages
ENV DATA_DIR=/data \
    KEY_DIR=/keys \
    STATIC_DIR=/app/pages \
    NODE_ENV=production
EXPOSE 8008
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
    CMD node -e "fetch('http://127.0.0.1:8008/api/health', { signal: AbortSignal.timeout(4000) }).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "src/main.ts"]
