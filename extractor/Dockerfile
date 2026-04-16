FROM node:20-slim

# Dependencias del sistema:
# - git: Baileys instala @WhiskeySockets/libsignal-node desde GitHub
#   (github: protocol) y npm necesita git para clonarlo
# - ca-certificates: TLS para el clone de git sobre HTTPS
# - python3 + build-essential: margen de seguridad para cualquier dep
#   transitiva que use node-gyp (no es estrictamente necesario con
#   Baileys 6.7.x actual, pero evita romper el build si suben deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
        git \
        ca-certificates \
        python3 \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /app/data/raw /app/data/audios /app/data/images /app/data/documents /app/auth_state

CMD ["node", "src/index.js"]
