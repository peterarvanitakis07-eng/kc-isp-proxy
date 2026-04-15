# Kept for reference — Railway uses nixpacks (see railway.toml).
# To enable Playwright browser scraping in future, switch builder to "DOCKERFILE"
# and uncomment this file after installing Chromium system deps.
#
# FROM node:18-slim
# RUN apt-get update && apt-get install -y chromium ...
# ENV CHROMIUM_PATH=/usr/bin/chromium
# WORKDIR /app
# COPY package*.json ./
# RUN npm ci --omit=dev
# COPY . .
# EXPOSE 3000
# CMD ["node", "server.js"]
