FROM node:22-slim

ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV PORT=3000
ENV TRADING_MODE=paper
ENV LIVE_TRADING_ENABLED=false
ENV YASHWIN_DB_PATH=/app/server/data/yashwin-trading.sqlite

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/server/data \
 && chown -R node:node /app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/api-server.js"]
