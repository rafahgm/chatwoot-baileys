import { connect, createState } from './baileys'
import { generateClient } from './database'
import { logger } from './logger'
import 'dotenv/config'

async function main() {
  const prisma = generateClient()
  const baileysState = createState(prisma)
  await connect(baileysState)
}

main().catch((error) => {
  logger.fatal(error, 'Falha na inicialização')
  process.exit(1)
})
/* import { PrismaClient } from '@prisma/client'
import { buildServer } from '~/http/server.js'
import { MediaStorageProcessor } from '~/storage.js'
import { ProcessOutgoingMessageUseCase } from './application/usecases/ProcessOutgoingMessage.js'
import { BaileysAdapter } from './infrastructure/baileys/BaileysAdapter.js'
import { ChatwootAdapter } from './infrastructure/chatwoot/ChatwootAdapter.js'
import { PrismaContactRepository } from './infrastructure/database/PrismaContactRepository.js'
import { logger } from './logger.js'
import { MessageRepository } from './repositories/messageRepository.js'
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

  const processOutgoing = new ProcessOutgoingMessageUseCase(
    messageRepo,
    baileys,
    mediaProcessor,
  )

  // Configurar handlers do Baileys
  baileys.onMessage(async (message) => {
    await MessageRepository.processIncoming(message)
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
 */
