import type { FastifyInstance } from 'fastify'

export async function statusRoutes(app: FastifyInstance) {
  app.get('/whatsapp', async (request, reply) => {
    const baileys = request.diContainer?.baileysService
    return {
      connected: baileys?.isConnected() || false,
      qrCode: baileys?.getQRCode?.() || null,
    }
  })
}
