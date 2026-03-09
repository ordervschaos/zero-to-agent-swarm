FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --production

COPY tsconfig.json ./
COPY src ./src

# Memory is mounted at runtime, not baked in
VOLUME /app/memory

CMD ["npx", "tsx", "src/index.ts"]
