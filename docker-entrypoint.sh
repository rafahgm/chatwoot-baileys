#!/bin/sh
set -e

# ==========================================
# Entrypoint Script - Baileys Chatwoot Bridge
# ==========================================

echo "🚀 Iniciando Baileys-Chatwoot..."

# Verificar variáveis obrigatórias
required_vars="CHATWOOT_BASE_URL CHATWOOT_API_TOKEN CHATWOOT_ACCOUNT_ID CHATWOOT_INBOX_ID"
for var in $required_vars; do
    if [ -z "$(eval echo \$$var)" ]; then
        echo "❌ Erro: Variável $var não definida!"
        exit 1
    fi
done

# Criar diretórios se não existirem (garantir permissões)
mkdir -p /app/auth_info /app/uploads /app/data

# Verificar se banco SQLite existe, senão criar
if [ ! -f "/app/data/prod.db" ]; then
    echo "📦 Criando banco de dados SQLite..."
    touch /app/data/prod.db
fi

# Rodar migrações do Prisma (se houver)
if [ -f "/app/prisma/schema.prisma" ]; then
    echo "🗄️  Verificando schema do Prisma..."
    npx prisma migrate deploy --schema=/app/prisma/schema.prisma || true
fi

# Verificar ffmpeg (essencial para áudio)
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "⚠️  Warning: ffmpeg não encontrado! Conversão de áudio não funcionará."
else
    echo "✅ ffmpeg disponível: $(ffmpeg -version | head -n1)"
fi

# Verificar espaço em disco para uploads
UPLOAD_DIR=${MEDIA_UPLOAD_DIR:-/app/uploads}
AVAILABLE_SPACE=$(df -P "$UPLOAD_DIR" | awk 'NR==2 {print $4}')
if [ "$AVAILABLE_SPACE" -lt 1048576 ]; then  # 1GB = 1048576 blocos de 1K
    echo "⚠️  Warning: Pouco espaço em disco disponível para uploads!"
fi

echo "✅ Configuração concluída. Iniciando aplicação..."
echo "📱 WhatsApp Auth: /app/auth_info"
echo "📤 Uploads: $UPLOAD_DIR"
echo "🗄️  Database: ${DATABASE_URL}"

# Executar comando passado (default: node dist/main.js)
exec "$@"