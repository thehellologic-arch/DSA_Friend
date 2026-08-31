FROM node:22-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY rubrics ./rubrics

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "packages/server/dist/index.js"]
