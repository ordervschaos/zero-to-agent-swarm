FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY tsconfig.json ./
COPY src ./src
COPY agents ./agents

# Memory and workspace are mounted at runtime, not baked in
VOLUME /app/memory
VOLUME /workspace

WORKDIR /workspace

CMD ["npx", "tsx", "/app/src/index.ts"]
