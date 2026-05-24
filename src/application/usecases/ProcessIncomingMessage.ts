import type { IContactRepository } from '../../domain/repositories/IContactRepository.js'
import type { IMessageRepository } from '../../domain/repositories/IMessage.js'
import type { Message } from '~/domain/entities/Message.js'
import { logger } from '~/config/logger.js'

export class ProcessIncomingMessage {
  constructor(
    private messageRepo: IMessageRepository,
    private contactRepo: IContactRepository,
    private chatwootService: IChatwootService,
    private mediaProcessor: IMediaProcessor,
  ) {}

  async execute(message: Message): Promise<void> {
    try {
      // 1. Salvar mensagem no banco de dados
      await this.messageRepo.save(message)

      // 2. Buscar ou criar o contato no chatwoot
      const contact = await this.findOrCreateContact(message)

      // 3. Se tem mídia, processar e fazer upload
      if (message.media) {
        message.media = await this.mediaProcessor.processIncomingMedia(
          message.media as any,
          message.type,
        )
      }

      // 4. Criar/obter conversa no chatwoot
      const conversationId = await this.chatwootService.createConversation(contact, message)

      // 5. Enviar mensagem para a conversa
      const result = await this.chatwootService.sendMessageToConversation(
        conversationId,
        message,
        message.media?.buffer,
        message.media?.filename,
      )

      // 6. Atualizar metadados
      message.chatwootConversationId = conversationId
      message.chatwootMessageId = result.id
      message.status = 'sent'
      await this.messageRepo.save(message)

      logger.info({
        messageId: message.id,
        conversationId,
        chatwootMessageId: result.id,
      }, 'Mensagem enviada ao chatwoot')
    }
    catch (error) {
      logger.error({ error, messageId: message.id }, 'Falha ao processar mensagem inbound')
      await this.messageRepo.updateStatus(message.id, 'failed', (error as Error).message)
      throw error
    }
  }
}
