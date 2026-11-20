# Build context is a staged bundle from tools/netplay/stage.mjs.
FROM node:22-bookworm-slim AS frp
COPY tools/studio/download-frp.mjs /download-frp.mjs
RUN node /download-frp.mjs && tar -xzf /tmp/frp.tar.gz -C /tmp

FROM node:22-bookworm-slim
COPY --from=frp /tmp/frp_0.72.0_linux_amd64/frps /usr/local/bin/frps
WORKDIR /app
COPY tools/netplay/package*.json ./tools/netplay/
RUN npm --prefix tools/netplay ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY tools/netplay/*.mjs ./tools/netplay/
COPY tools/studio/gateway.mjs ./tools/studio/
COPY tools/netplay/frps.toml ./tools/netplay/
COPY sim/ ./sim/
COPY data/catalog.json ./data/catalog.json
COPY web/ ./web/
ENV NODE_ENV=production NETPLAY_HOST=0.0.0.0 PORT=7860 NETPLAY_WEB_ROOT=/app/web NETPLAY_TRACE_DIR=/tmp/wanwu-netplay-traces
USER node
EXPOSE 7860
CMD ["node", "tools/netplay/main.mjs"]
