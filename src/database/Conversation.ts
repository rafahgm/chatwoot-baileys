import { PrismaClient, Prisma } from '../../../generated/prisma/client';
import { Conversation } from '~/domain/entities/Conversation.js';

export class PrismaConversationRepository {
  constructor(private prisma: PrismaClient) {}

  async save(conversation: Conversation): Promise<void> {
    const data: Prisma.ConversationCreateInput = {
      id: conversation.id,
      chatId: conversation.chatId,
      contactId: conversation.contactId,
      chatwootConversationId: conversation.chatwootConversationId,
      status: conversation.status,
      openedAt: conversation.openedAt,
      resolvedAt: conversation.resolvedAt,
      lastMessageAt: conversation.lastMessageAt,
    };

    await this.prisma.conversation.upsert({
      where: { id: conversation.id },
      update: data,
      create: data,
    });
  }

  async findById(id: string): Promise<<Conversation | null> {
    const row = await this.prisma.conversation.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByChatwootId(chatwootConversationId: number): Promise<<Conversation | null> {
    const row = await this.prisma.conversation.findUnique({
      where: { chatwootConversationId },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByChatId(chatId: string): Promise<<Conversation | null> {
    const row = await this.prisma.conversation.findFirst({
      where: { chatId },
      orderBy: { openedAt: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByContactId(contactId: string): Promise<<Conversation[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { contactId },
      orderBy: { openedAt: 'desc' },
    });
    return rows.map(r => this.toDomain(r));
  }

  async findActiveByChatId(chatId: string): Promise<<Conversation | null> {
    const row = await this.prisma.conversation.findFirst({
      where: {
        chatId,
        status: { in: ['open', 'pending'] },
      },
      orderBy: { openedAt: 'desc' },
    });
    return row ? this.toDomain(row) : null;
  }

  async updateStatus(id: string, status: 'open' | 'resolved' | 'pending' | 'snoozed'): Promise<void> {
    const data: any = { status };
    if (status === 'resolved') data.resolvedAt = new Date();
    if (status === 'open') data.resolvedAt = null;

    await this.prisma.conversation.update({
      where: { id },
      data,
    });
  }

  async updateChatwootId(id: string, chatwootConversationId: number): Promise<void> {
    await this.prisma.conversation.update({
      where: { id },
      data: { chatwootConversationId },
    });
  }

  async resolve(id: string): Promise<void> {
    await this.updateStatus(id, 'resolved');
  }

  async reopen(id: string): Promise<void> {
    await this.updateStatus(id, 'open');
  }

  async findOpen(limit = 100): Promise<<Conversation[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { status: { in: ['open', 'pending'] } },
      orderBy: { lastMessageAt: 'desc' },
      take: limit,
    });
    return rows.map(r => this.toDomain(r));
  }

  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.prisma.conversation.deleteMany({
      where: { resolvedAt: { lt: date } },
    });
    return result.count;
  }

  // ===== Mapper =====

  private toDomain(row: any): Conversation {
    return {
      id: row.id,
      chatId: row.chatId,
      contactId: row.contactId,
      chatwootConversationId: row.chatwootConversationId,
      status: row.status,
      openedAt: row.openedAt,
      resolvedAt: row.resolvedAt || undefined,
      lastMessageAt: row.lastMessageAt,
    };
  }
}