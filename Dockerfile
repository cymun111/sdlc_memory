FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/schemas ./schemas
COPY --from=build /app/knowledge ./knowledge
COPY --from=build /app/registry ./registry
RUN mkdir -p /var/lib/engineering-knowledge
ENV KNOWLEDGE_RUNTIME_ROOT=/var/lib/engineering-knowledge
VOLUME ["/var/lib/engineering-knowledge"]
CMD ["node", "dist/cli.js", "status"]
