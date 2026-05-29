import type { FastifyInstance } from 'fastify'
import { createHmac } from 'node:crypto'
import { ProcessOutgoingMessageUseCase } from '../../../application/usecases/ProcessOutgoingMessage.js'
import { logger } from '../../../config/logger.js'

export async function webhookRoutes(app: FastifyInstance) {
  // Webhook do Chatwoot -> Enviar para WhatsApp
  app.post('/chatwoot', async (request, reply) => {
    try {
      // Validar HMAC se configurado
      const signature = request.headers['x-chatwoot-signature'] as string
      const timestamp = request.headers['x-chatwoot-timestamp'] as string

      if (process.env.WEBHOOK_SECRET && signature) {
        const expectedSig = createHmac('sha256', process.env.WEBHOOK_SECRET)
          .update(JSON.stringify(request.body))
          .digest('hex')

        if (signature !== expectedSig) {
          return reply.status(401).send({ error: 'Invalid signature' })
        }
      }

      const payload = request.body as any

      // Log para debug
      logger.debug({ event: payload.event, messageId: payload.message?.id }, 'Webhook Chatwoot')

      // Processar apenas mensagens enviadas pelo agente (outgoing)
      if (payload.event === 'message_created' && payload.message?.message_type === 'outgoing') {
        const useCase = request.diContainer?.processOutgoingUseCase
        if (useCase) {
          await useCase.execute(payload)
        }
      }

      // Responder rapidamente para evitar timeout do Chatwoot
      return reply.status(200).send({ received: true })
    }
    catch (error) {
      logger.error({ error, body: request.body }, 'Erro no webhook Chatwoot')
      // Sempre retornar 200 para evitar retries excessivos
      return reply.status(200).send({ received: true, error: (error as Error).message })
    }
  })
}
