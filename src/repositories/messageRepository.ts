import type { Message, PrismaClient } from '~/prisma/client'

export class MessageRepository {
  constructor(private prisma: PrismaClient) {}

  async save(message: Message): Promise<void> {
    await this.prisma.message.upsert({
      where: { id: message.id },
      update: message,
      create: message,
    })
  }

  async findById(id: string): Promise<Message | null> {
    const row = await this.prisma.message.findUnique({ where: { id } })
    return row ? this.toDomain(row) : null
  }

  async findByExternalId(externalId: string): Promise<Message | null> {
    const row = await this.prisma.message.findUnique({ where: { externalId } })
    return row ? this.toDomain(row) : null
  }

  async findByChatwootMessageId(chatwootMessageId: number): Promise<Message | null> {
    const row = await this.prisma.message.findFirst({
      where: { chatwootMessageId },
    })
    return row ? this.toDomain(row) : null
  }

  async findByConversationId(conversationId: number, limit = 50): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({
      where: { chatwootConversationId: conversationId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })
    return rows.map(r => this.toDomain(r))
  }

  async findPendingOutbound(limit = 100): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        direction: 'outbound',
        status: { in: ['pending', 'failed'] },
      },
      orderBy: { timestamp: 'asc' },
      take: limit,
    })
    return rows.map(r => this.toDomain(r))
  }

  async findFailed(limit = 50): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({
      where: { status: 'failed' },
      orderBy: { timestamp: 'desc' },
      take: limit,
    })
    return rows.map(r => this.toDomain(r))
  }

  async updateStatus(
    id: string,
    status: MessageStatus,
    error?: string,
    deliveredAt?: Date,
    readAt?: Date,
  ): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        status,
        error: error || null,
        deliveredAt: deliveredAt || null,
        readAt: readAt || null,
      },
    })
  }

  async updateChatwootRefs(
    id: string,
    chatwootConversationId: number,
    chatwootMessageId: number,
  ): Promise<void> {
    await this.prisma.message.update({
      where: { id },
      data: {
        chatwootConversationId,
        chatwootMessageId,
      },
    })
  }

  async findByChatId(
    chatId: string,
    options?: { direction?: 'inbound' | 'outbound', before?: Date, limit?: number },
  ): Promise<Message[]> {
    const rows = await this.prisma.message.findMany({
      where: {
        chatId,
        ...(options?.direction && { direction: options.direction }),
        ...(options?.before && { timestamp: { lt: options.before } }),
      },
      orderBy: { timestamp: 'desc' },
      take: options?.limit || 50,
    })
    return rows.map(r => this.toDomain(r))
  }

  async countByStatus(status: MessageStatus): Promise<number> {
    return this.prisma.message.count({ where: { status } })
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.prisma.message.deleteMany({
      where: { timestamp: { lt: date } },
    })
    return result.count
  }

  // ===== Mapper =====

  private toDomain(row: any): Message {
    return {
      id: row.id,
      externalId: row.externalId,
      direction: row.direction as MessageDirection,
      type: row.type as MessageType,
      from: row.from,
      to: row.to,
      chatId: row.chatId,
      content: row.content || undefined,
      media: row.mediaUrl
        ? {
            url: row.mediaUrl,
            mimeType: row.mediaMimeType || undefined,
            fileName: row.mediaFileName || undefined,
            fileSize: row.mediaFileSize || undefined,
            duration: row.mediaDuration || undefined,
          }
        : undefined,
      isGroup: row.isGroup,
      quotedMessageId: row.quotedMessageId || undefined,
      timestamp: row.timestamp,
      status: row.status as MessageStatus,
      error: row.error || undefined,
      chatwootConversationId: row.chatwootConversationId || undefined,
      chatwootMessageId: row.chatwootMessageId || undefined,
      chatwootContactId: row.chatwootContactId || undefined,
    }
  }

  static async processIncoming(message: Message): Promise<void> {
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

  async processOutgoing(chatwootPayload: any): Promise<void> {
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
