FROM node:22-alpine
WORKDIR /app
RUN npm install --global pnpm@10.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server.js ./
COPY public ./public
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node","server.js"]
