# ==============================================================================
# Dockerfile pour Google Cloud Run — Service "vless-manager" (us-central1)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copie des manifestes de dépendances
COPY package*.json tsconfig.json vite.config.ts ./

# Installation des dépendances complètes pour la compilation
RUN npm ci || npm install

# Copie du code source complet
COPY index.html ./
COPY src/ ./src/
COPY server.ts ./

# Compilation du frontend React Vite et vérification TypeScript
RUN npm run build

# ==============================================================================
# Image de production finale ultra-légère
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/tmp

# Copie des dépendances de production
COPY package*.json ./
RUN npm ci --only=production || npm install --omit=dev

# Installation de tsx pour l'exécution rapide de TypeScript en production
RUN npm install -g tsx

# Copie des fichiers construits et du serveur
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./server.ts

# Création d'un utilisateur non-root pour des raisons de sécurité
USER node

EXPOSE 8080

# Commande de démarrage sur Google Cloud Run
CMD ["npx", "tsx", "server.ts"]
