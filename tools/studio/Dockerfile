FROM node:22-bookworm-slim AS download
COPY download-frp.mjs /download-frp.mjs
RUN node /download-frp.mjs
RUN tar -xzf /tmp/frp.tar.gz -C /tmp

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=download /tmp/frp_0.72.0_linux_amd64/frps /usr/local/bin/frps
COPY gateway.mjs start.mjs frps.toml /app/
COPY web/ /app/web/
ENV WANWU_WEB_ROOT=/app/web
EXPOSE 7860
CMD ["node", "/app/start.mjs"]
