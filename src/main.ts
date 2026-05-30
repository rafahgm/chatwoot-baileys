import { PrismaClient } from '@prisma/client'
import { ProcessIncomingMessageUseCase } from './application/usecases/ProcessIncomingMessage.js'
import { ProcessOutgoingMessageUseCase } from './application/usecases/ProcessOutgoingMessage.js'
import { BaileysAdapter } from './infrastructure/baileys/BaileysAdapter.js'
import { ChatwootAdapter } from './infrastructure/chatwoot/ChatwootAdapter.js'
import { PrismaContactRepository } from './infrastructure/database/PrismaContactRepository.js'
import { PrismaMessageRepository } from './infrastructure/database/PrismaMessageRepository.js'
import { MediaStorageProcessor } from './infrastructure/storage/MediaStorage.js'
import { buildServer } from './interface/http/server.js'
import { logger } from './logger.js'
import 'dotenv/config'

async function main() {
  const prisma = new PrismaClient()

  // Repositórios
  const messageRepo = new PrismaMessageRepository(prisma)
  const contactRepo = new PrismaContactRepository(prisma)

  // Serviços
  const baileys = new BaileysAdapter(process.env.BAILEYS_AUTH_DIR || './auth_info')
  const chatwoot = new ChatwootAdapter()
  const mediaProcessor = new MediaStorageProcessor()

  // Use Cases
  const processIncoming = new ProcessIncomingMessageUseCase(
    messageRepo,
    contactRepo,
    chatwoot,
    mediaProcessor,
  )
  const processOutgoing = new ProcessOutgoingMessageUseCase(
    messageRepo,
    baileys,
    mediaProcessor,
  )

  // Configurar handlers do Baileys
  baileys.onMessage(async (message) => {
    await processIncoming.execute(message)
  })

  baileys.onConnectionUpdate((state) => {
    logger.info(state, 'Estado da conexão WhatsApp')
  })

  // Conectar ao WhatsApp
  await baileys.connect()

  // Iniciar servidor HTTP
  const app = await buildServer()

  // Injeção de dependências simples
  app.decorate('diContainer', {
    baileysService: baileys,
    processOutgoingUseCase: processOutgoing,
  })

  const port = Number.parseInt(process.env.PORT || '3000')
  await app.listen({ port, host: '0.0.0.0' })

  logger.info(`Servidor rodando na porta ${port}`)
  logger.info(`Webhook Chatwoot: POST http://localhost:${port}/webhooks/chatwoot`)
}

main().catch((error) => {
  logger.fatal(error, 'Falha na inicialização')
  process.exit(1)
})
