FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /home/node/app
COPY package*.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV PORT=8000 DATABASE=/data HDHR_DISCOVERY=false
EXPOSE 8000
CMD ["node", "index.js"]
