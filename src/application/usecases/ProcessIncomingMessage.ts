import type { Message } from '../../domain/entities/Message.js'
import type { IContactRepository } from '../../domain/repositories/IContactRepository.js'
import type { IMessageRepository } from '../../domain/repositories/IMessageRepository.js'
import type { IMediaProcessor } from '../../domain/services/MediaProcessor.js'
import type { IChatwootService } from '../ports/IChatwootService.js'
import { logger } from '../../logger.js'
import { MessageDirection, MessageType } from '../../domain/entities/Message.js'

export class ProcessIncomingMessageUseCase {
  constructor(
    private messageRepo: IMessageRepository,
    private contactRepo: IContactRepository,
    private chatwootService: IChatwootService,
    private mediaProcessor: IMediaProcessor,
  ) {}

  async execute(message: Message): Promise<void> {
    try {
      // 1. Salvar mensagem no banco local
      await this.messageRepo.save(message)

      // 2. Buscar ou criar contato no Chatwoot
      const contact = await this.findOrCreateContact(message)

      // 3. Se tem mídia, processar e fazer upload
      if (message.media) {
        message.media = await this.mediaProcessor.processIncomingMedia(
          message.media as any, // adaptar conforme necessário
          message.type,
        )
      }

      // 4. Criar/obter conversa no Chatwoot
      const conversationId = await this.chatwootService.createConversation(contact, message)

      // 5. Enviar mensagem para a conversa
      const result = await this.chatwootService.sendMessageToConversation(
        conversationId,
        message,
        message.media?.buffer,
        message.media?.fileName,
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
      }, 'Mensagem enviada ao Chatwoot')
    }
    catch (error) {
      logger.error({ error, messageId: message.id }, 'Falha ao processar mensagem inbound')
      await this.messageRepo.updateStatus(message.id, 'failed', (error as Error).message)
      throw error
    }
  }

  private async findOrCreateContact(message: Message) {
    let contact = await this.contactRepo.findByJid(message.from)
    if (!contact) {
      // Extrair número do JID
      const phone = message.from.split('@')[0].split(':')[0]
      contact = {
        id: message.from,
        phoneNumber: phone,
        pushName: message.from,
        isBusiness: false,
      }
      await this.contactRepo.save(contact)
    }
    return contact
  }
}
