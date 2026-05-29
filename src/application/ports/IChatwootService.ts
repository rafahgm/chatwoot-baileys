import type { Buffer } from 'node:buffer'
import type { Contact } from '~/domain/entities/Contact.js'
import type { Message } from '~/domain/entities/Message.js'

export interface IChatwootService {
  // Webhooks recebidos do Chatwoot
  processWebhook: (payload: ChatwootWebhookPayload) => Promise<void>

  // Enviar para Chatwoot
  createConversation: (contact: Contact, message: Message) => Promise<number> // retorna conversationId
  sendMessageToConversation: (
    conversationId: number,
    message: Message,
    mediaBuffer?: Buffer,
    mediaFileName?: string,
  ) => Promise<{ id: number }>

  // Buscar/criar contato
  findOrCreateContact: (contact: Contact) => Promise<{ id: number, contactInboxId?: number }>

  // Upload de mídia para o Chatwoot
  uploadAttachment: (
    conversationId: number,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ) => Promise<{ blobId: string, url: string }>
}

export interface ChatwootWebhookPayload {
  event: 'message_created' | 'conversation_created' | 'conversation_status_changed'
  message?: {
    id: number
    content: string
    message_type: 'incoming' | 'outgoing'
    content_type: 'text' | 'input_select' | 'cards' | 'form' | 'article' | 'incoming_email'
    content_attributes?: {
      items?: Array<{
        type: 'text' | 'image' | 'audio' | 'video' | 'file'
        media_url?: string
        file_type?: string
        payload?: string
      }>
    }
    attachments?: Array<{
      file_type: string
      data_url: string
      filename: string
      file_size: number
    }>
    sender: {
      id: number
      name: string
      email?: string
      phone_number?: string
      identifier?: string
      thumbnail?: string
    }
    conversation: {
      id: number
      inbox_id: number
      status: string
      contact_inbox: {
        source_id: string
      }
    }
  }
}
