# ==========================================
# Stage 1: Dependencies
# ==========================================
FROM node:24-alpine AS deps

# Instalar dependências nativas necessárias para compilação
RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

# Copiar apenas arquivos de dependência para cache eficiente
COPY package.json package-lock.json* ./
RUN npm ci --only=production && npm cache clean --force

# ==========================================
# Stage 2: Builder (TypeScript compilation)
# ==========================================
FROM node:24-alpine AS builder

WORKDIR /app

# Copiar dependências do stage anterior
COPY --from=deps /app/node_modules ./node_modules

# Copiar código fonte e configs
COPY . .

# Instalar dependências de dev para build (prisma, typescript, etc.)
RUN npm ci --include=dev

# Gerar cliente Prisma
RUN npx prisma generate

# Compilar TypeScript
RUN npm run build

# ==========================================
# Stage 3: Production Runner
# ==========================================
FROM node:20-alpine AS runner

# Labels
LABEL maintainer="seu-email@exemplo.com"
LABEL description="Baileys-Chatwoot Bridge - WhatsApp Web Integration"
LABEL version="1.0.0"

# Criar usuário não-root para segurança
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 baileys

# Instalar dependências de runtime:
# - ffmpeg: conversão de áudio (OGG/Opus ↔ MP3)
# - curl: healthchecks
# - ca-certificates: HTTPS requests
# - tzdata: timezone support
RUN apk add --no-cache \
    ffmpeg \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/cache/apk/*

WORKDIR /app

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000
ENV TZ=America/Sao_Paulo

# Copiar apenas artefatos necessários da produção
COPY --from=deps --chown=baileys:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=baileys:nodejs /app/dist ./dist
COPY --from=builder --chown=baileys:nodejs /app/prisma ./prisma
COPY --from=builder --chown=baileys:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Copiar scripts de entrypoint
COPY --chown=baileys:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Criar diretórios de dados com permissões corretas
RUN mkdir -p /app/auth_info /app/uploads /app/data && \
    chown -R baileys:nodejs /app

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:${PORT}/health || exit 1

# Usar usuário não-root
USER baileys

# Expor porta
EXPOSE ${PORT}

# Volumes para persistência
VOLUME ["/app/auth_info", "/app/uploads", "/app/data"]

# Entrypoint
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]