FROM node:20-slim

# Dependencias para Chromium (necesario para whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
    libgbm-dev \
    libnss3 \
    libatk-bridge2.0-0 \
    libxkbcommon0 \
    libxcomposite1 \
    libxrandr2 \
    libgdk-pixbuf2.0-0 \
    libgtk-3-0 \
    libasound2 \
    fonts-noto-color-emoji \
    fonts-noto \
    && rm -rf /var/lib/apt/lists/*

# Variables de entorno para Puppeteer/Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar package.json primero para cachear dependencias
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# Copiar código fuente
COPY src/ ./src/

# Crear directorios de datos
RUN mkdir -p /app/data/raw /app/data/audios /app/.wwebjs_auth

# No correr como root
RUN groupadd -r appuser && useradd -r -g appuser appuser
RUN chown -R appuser:appuser /app
# Chromium (--no-sandbox + --single-process) requiere root dentro del contenedor
# USER appuser

CMD ["node", "src/index.js"]
