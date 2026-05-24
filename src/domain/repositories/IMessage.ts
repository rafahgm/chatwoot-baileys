import type { Message } from '../entities/Message.js'

export interface IMessageRepository {
  save: (message: Message) => Promise<void>
  findByExternalId: (externalId: string) => Promise<Message | null>
  findByChatwootMessageId: (chatwootId: number) => Promise<Message | null>
  updateStatus: (id: string, status: Message['status'], error?: string) => Promise<void>
  findPendingOutbound: () => Promise<Message[]>
}
