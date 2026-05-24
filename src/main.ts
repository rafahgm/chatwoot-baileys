import { logger } from './config/logger.js'
import { BaileysAdapter } from './infrastructure/baileys/BaileysAdapter.js'

async function main() {
  // const prisma =  new PrismaClient();

  // Repositórios
  // const messageRepo = new PrismaMessageRepository(prisma);
  // const contactRepo = new PrismaContactRepository(prisma);

  // Serviços
  const baileys = new BaileysAdapter(process.env.BAILEYS_AUTH_DIR || './auth_info')

  baileys.onMessage(async (message) => {
    console.log({ message })
  })

  baileys.onConnectionUpdate((state) => {
    logger.info(state, 'Estado de conexão do whatsapp')
  })

  // Conectar ao Whatsapp
  await baileys.connect()
}

main().catch((error) => {
  logger.fatal(error, 'Falha na inicialização')
  process.exit(1)
})
