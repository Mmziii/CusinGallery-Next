FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
# Optional npm registry mirror for networks where registry.npmjs.org is
# slow or blocked (see docs/DEPLOY.md, section 23-2). Empty = npm's own
# default; no mirror is assumed or hard-coded anywhere.
ARG NPM_CONFIG_REGISTRY=""
RUN if [ -n "$NPM_CONFIG_REGISTRY" ]; then npm ci --registry="$NPM_CONFIG_REGISTRY"; else npm ci; fi

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_ANALYTICS_SCRIPT_URL=""
ARG NEXT_PUBLIC_ANALYTICS_SITE_ID=""
ARG NEXT_PUBLIC_SENTRY_DSN=""
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
