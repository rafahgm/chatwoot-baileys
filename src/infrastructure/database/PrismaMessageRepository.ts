import type { Prisma, PrismaClient } from '../../../generated/prisma/client'
import type { Message, MessageDirection, MessageStatus, MessageType } from '~/domain/entities/Message.js'

export class PrismaMessageRepository {
  constructor(private prisma: PrismaClient) {}

  async save(message: Message): Promise<void> {
    const data: Prisma.MessageCreateInput = {
      id: message.id,
      externalId: message.externalId,
      direction: message.direction,
      type: message.type,
      from: message.from,
      to: message.to,
      chatId: message.chatId,
      content: message.content,
      mediaUrl: message.media?.url,
      mediaMimeType: message.media?.mimeType,
      mediaFileName: message.media?.fileName,
      mediaFileSize: message.media?.fileSize,
      mediaDuration: message.media?.duration,
      isGroup: message.isGroup,
      quotedMessageId: message.quotedMessageId,
      timestamp: message.timestamp,
      status: message.status,
      error: message.error,
      chatwootConversationId: message.chatwootConversationId,
      chatwootMessageId: message.chatwootMessageId,
      chatwootContactId: message.chatwootContactId,
    }

    await this.prisma.message.upsert({
      where: { id: message.id },
      update: data,
      create: data,
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
}
