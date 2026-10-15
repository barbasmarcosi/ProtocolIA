# The complete app is GENERATED from external TypeSpec during image build.
# No handwritten resource controllers, React screens or SQL are copied in.
FROM node:24-bookworm AS builder
WORKDIR /source
COPY . .
RUN npm ci --no-audit --no-fund
RUN npm run app:build -- examples/vnext/volunteer-evaluations --target nestjs --out /tmp/independent-volunteer-app

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
