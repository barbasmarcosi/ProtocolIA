# The complete app is GENERATED from external TypeSpec during image build.
# No handwritten resource controllers, React screens or SQL are copied in.
FROM node:24-bookworm AS builder
WORKDIR /source
COPY . .
RUN npm ci --no-audit --no-fund
# Rebuild the immutable UX4 release first; evolve to UX5 with a versioned additive
# migration. Never rewrite V1 or force a new schema digest over existing Neon data.
# Docker overlay cannot rename a directory created in an earlier image layer (EXDEV).
# Build and evolve in a single RUN so the immutable generated V1 can be atomically
# replaced with its V2 migration while preserving the prior schema fingerprint.
RUN npm run app:build -- deployment/volunteer-evaluations/releases/ux4 --target nestjs --out /tmp/independent-volunteer-app \
  && node packages/cli/protocolia.mjs evolve examples/vnext/volunteer-evaluations /tmp/independent-volunteer-app

FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /tmp/independent-volunteer-app/node_modules ./node_modules
COPY --from=builder /tmp/independent-volunteer-app/package.json ./package.json
COPY --from=builder /tmp/independent-volunteer-app/dist ./dist
COPY --from=builder /tmp/independent-volunteer-app/src/schema.sql ./src/schema.sql
COPY --from=builder /tmp/independent-volunteer-app/src/migrations ./src/migrations
EXPOSE 10000
CMD ["node", "dist/main.js"]
