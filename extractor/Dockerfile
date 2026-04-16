FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/data/raw /app/data/audios /app/data/images /app/data/documents /app/auth_state

CMD ["node", "src/index.js"]
