FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
# Symlink persistent volume cache to expected location at runtime
RUN mkdir -p /app/.cache
EXPOSE 3001
CMD ["sh", "-c", "ln -sf /data/.cache /app/.cache 2>/dev/null || true && node server.js"]
