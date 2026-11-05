FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ARG APP_REVISION=local
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data APP_REVISION=$APP_REVISION
LABEL org.opencontainers.image.source="https://github.com/theCowBoiCoder/toga_cards" org.opencontainers.image.revision=$APP_REVISION
COPY --from=build /app/.output ./.output
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
