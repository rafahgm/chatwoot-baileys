import type { Message } from '../../domain/entities/Message.js'
import type { IMessageRepository } from '../../domain/repositories/IMessageRepository.js'
import type { IMediaProcessor } from '../../domain/services/MediaProcessor.js'
import type { IBaileysService } from '../ports/IBaileysService.js'
import { logger } from '../../config/logger.js'
import { MessageDirection, MessageType } from '../../domain/entities/Message.js'

export class ProcessOutgoingMessageUseCase {
  constructor(
    private messageRepo: IMessageRepository,
    private baileysService: IBaileysService,
    private mediaProcessor: IMediaProcessor,
  ) {}

  async execute(chatwootPayload: any): Promise<void> {
    const { message, conversation } = chatwootPayload

    // Ignorar mensagens inbound (já vêm do WhatsApp)
    if (message.message_type === 'incoming')
      return

    try {
      // Extrair destino do source_id (número de telefone)
      const destinationPhone = conversation.contact_inbox.source_id
      const toJid = this.baileysService.formatPhoneToJid(destinationPhone)

      let waMessageId: string

      // Verificar se tem mídia
      if (message.attachments && message.attachments.length > 0) {
        const attachment = message.attachments[0]
        const mediaType = this.mapChatwootTypeToBaileys(attachment.file_type)

        // Processar mídia
        const { buffer, mimeType, fileName } = await this.mediaProcessor.processOutgoingMedia(
          attachment.data_url,
          mediaType,
        )

        waMessageId = await this.baileysService.sendMediaMessage(
          toJid,
          mediaType === 'audio' && message.content?.includes('🎤') ? 'audio' : mediaType,
          { buffer, url: attachment.data_url },
          {
            caption: message.content,
            fileName,
            mimeType,
            ptt: mediaType === 'audio' && message.content?.includes('🎤'), // voice note
          },
        )
      }
      else if (message.content_attributes?.items) {
        // Mensagem com botões/cards - enviar como texto formatado
        const formattedContent = this.formatInteractiveMessage(message.content_attributes.items)
        waMessageId = await this.baileysService.sendTextMessage(toJid, formattedContent)
      }
      else {
        // Texto simples
        waMessageId = await this.baileysService.sendTextMessage(toJid, message.content)
      }

      // Salvar registro
      const localMessage: Message = {
        id: waMessageId,
        externalId: waMessageId,
        direction: MessageDirection.OUTBOUND,
        type: MessageType.TEXT,
        from: 'me',
        to: toJid,
        chatId: toJid,
        content: message.content,
        isGroup: false,
        timestamp: new Date(),
        status: 'sent',
        chatwootMessageId: message.id,
        chatwootConversationId: conversation.id,
      }

      await this.messageRepo.save(localMessage)
      logger.info({ waMessageId, chatwootMessageId: message.id }, 'Mensagem enviada ao WhatsApp')
    }
    catch (error) {
      logger.error({ error, chatwootMessageId: message.id }, 'Falha ao enviar mensagem outbound')
      throw error
    }
  }

  private mapChatwootTypeToBaileys(fileType: string): 'image' | 'video' | 'audio' | 'document' {
    if (fileType.startsWith('image/'))
      return 'image'
    if (fileType.startsWith('video/'))
      return 'video'
    if (fileType.startsWith('audio/'))
      return 'audio'
    if (fileType.startsWith('voice/'))
      return 'audio' // voice notes
    return 'document'
  }

  private formatInteractiveMessage(items: any[]): string {
    return items.map((item) => {
      if (item.type === 'text')
        return item.payload || item.title
      if (item.media_url)
        return `${item.title}\n${item.media_url}`
      return item.title || ''
    }).join('\n\n')
  }
}
