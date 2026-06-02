#!/bin/sh
set -e

echo "🚀 Iniciando ambiente de desenvolvimento..."

# Criar diretórios se não existirem
mkdir -p /app/auth_info /app/uploads /app/data

# Prisma: gerar client e aplicar migrações existentes
if [ -f "/app/prisma/schema.prisma" ]; then
    echo "🗄️  Gerando Prisma Client..."
    npx prisma generate --schema=/app/prisma/schema.prisma

    echo "🗄️  Aplicando migrações..."
    npx prisma migrate deploy --schema=/app/prisma/schema.prisma || true
fi

# Verificar ffmpeg
if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "⚠️  Warning: ffmpeg não encontrado!"
else
    echo "✅ ffmpeg: $(ffmpeg -version | head -n1 | cut -d' ' -f3)"
fi

echo "✅ Pronto. Iniciando aplicação..."

exec "$@"
