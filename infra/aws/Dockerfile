FROM node:22-bookworm-slim AS runtime

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps apps
COPY packages packages

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production
ENV HOST=0.0.0.0

FROM runtime AS worker
CMD ["pnpm", "--filter", "@meridian/worker", "start"]

FROM runtime AS agent
CMD ["pnpm", "--filter", "@meridian/agent", "start"]

FROM runtime AS webbuild
ENV VITE_API_URL=
RUN pnpm --filter @meridian/web build

FROM caddy:2-alpine AS edge
COPY infra/aws/Caddyfile /etc/caddy/Caddyfile
COPY --from=webbuild /app/apps/web/dist /srv/web

FROM runtime AS api
EXPOSE 3000
CMD ["pnpm", "--filter", "@meridian/api", "start"]
