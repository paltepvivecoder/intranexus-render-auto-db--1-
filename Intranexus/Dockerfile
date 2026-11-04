FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY server ./server
COPY public ./public

ENV PORT=3000
EXPOSE 3000
USER node
CMD ["node", "server/app.js"]
