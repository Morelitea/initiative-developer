# Build the app, then ship only what runs it: no compiler, no npm, no root.

FROM node:26-alpine@sha256:d1afba4b9c2edf2dcc56684c90e6c670309eecbc558b9d4bc7f530efb9934b43 AS build

WORKDIR /app

# Dependencies first, so a source-only change reuses the install layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm prune --omit=dev


FROM node:26-alpine@sha256:d1afba4b9c2edf2dcc56684c90e6c670309eecbc558b9d4bc7f530efb9934b43 AS runtime

# The runtime invokes Node directly, so npm and npx are not shipped.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

ARG VERSION=0.0.0-dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="initiative-github" \
      org.opencontainers.image.description="GitHub for Initiative: issues, reviews and dependency alerts." \
      org.opencontainers.image.source="https://github.com/Morelitea/initiative-developer" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}"

ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist/src ./dist/src
COPY package.json ./

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/src/main.js"]
