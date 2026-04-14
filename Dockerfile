# KC ISP Navigator Proxy — with Playwright/Chromium for live ISP price scraping
# Uses Microsoft's official Playwright image (includes Chromium + all system deps)
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

EXPOSE 3000
CMD ["node", "server.js"]
