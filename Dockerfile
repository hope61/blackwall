# BLACKWALL — no dependencies, so there is nothing to install and no build step.
# The image is the runtime plus source.
FROM node:20-alpine

# curl is only for the container healthcheck; busybox wget mishandles our
# no-store JSON responses on some kernels.
RUN apk add --no-cache curl tzdata

ENV NODE_ENV=production \
    PORT=8787 \
    TZ=UTC

WORKDIR /app

# Cache lives on a volume. Create it up front owned by the unprivileged user
# so the server can spill to disk without running as root.
RUN mkdir -p /app/.cache && chown -R node:node /app

COPY --chown=node:node package.json ./
COPY --chown=node:node panels.config.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web

USER node

EXPOSE 8787

# The 22 upstreams are polled on their own TTLs; a slow cold start is normal,
# so give the healthcheck a generous grace period before it counts failures.
HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" || exit 1

CMD ["node", "server/index.js"]
