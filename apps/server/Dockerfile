# NET360 Classroom realtime server (Railway, or any container host).
# Build from the repository root:  docker build -f apps/server/Dockerfile .
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

# Install only what the server needs (the web app is deployed separately on Vercel).
COPY package.json package-lock.json ./
COPY packages/protocol/package.json packages/protocol/
COPY packages/board-engine/package.json packages/board-engine/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev --workspace apps/server --workspace packages/protocol --no-audit --no-fund \
  && npm cache clean --force

COPY packages/protocol/src packages/protocol/src
COPY apps/server/src apps/server/src
COPY apps/server/db apps/server/db

WORKDIR /app/apps/server
USER node
# Railway provides PORT; the server listens on it.
EXPOSE 4000
CMD ["node", "--import", "tsx", "src/index.ts"]
