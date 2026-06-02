import multipart from '@fastify/multipart'
import Fastify from 'fastify'
import { logger } from '~/logger.js'
import { statusRoutes } from './routes/status.js'

export async function buildServer() {
  const app = Fastify({
    logger: logger.child({ module: 'http' }),
    bodyLimit: 52428800, // 50MB para upload de midia
  })

  await app.register(multipart, { limits: { fileSize: 52428800 } })

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  // Rotas
  await app.register(statusRoutes, { prefix: '/status' })

  // Servir arquivos de mídia
  app.get('/uploads/:fileName', async (request, reply) => {
    const { fileName } = request.params as { fileName: string }

    return reply.sendFile(fileName, process.env.MEDIA_UPLOAD_DIR || './uploads')
  })

  app.setErrorHandler((error, request, reply) => {
    logger.error({ error, url: request.url }, 'HTTP Error')
    reply.status(500).send({ error: 'Internal Server Error' })
  })

  return app
}
