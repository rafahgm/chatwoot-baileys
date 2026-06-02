import type { AxiosInstance } from 'axios'
import type { Contact, Message } from '~/database/Message.js'
import axios from 'axios'
import FormData from 'form-data'
import { logger } from '~/logger.js'

export class ChatwootAdapter {
  private client: AxiosInstance
  private baseUrl: string
  private accountId: number
  private inboxId: number

  constructor() {
    this.baseUrl = process.env.CHATWOOT_BASE_URL!
    this.accountId = Number.parseInt(process.env.CHATWOOT_ACCOUNT_ID!)
    this.inboxId = Number.parseInt(process.env.CHATWOOT_INBOX_ID!)

    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v1`,
      headers: {
        'Content-Type': 'application/json',
        'Api-Access-Token': process.env.CHATWOOT_API_TOKEN!,
      },
      timeout: 30000,
    })

    // Interceptor para logging
    this.client.interceptors.response.use(
      response => response,
      (error) => {
        logger.error({
          error: error.response?.data || error.message,
          status: error.response?.status,
          url: error.config?.url,
        }, 'Chatwoot API error')
        return Promise.reject(error)
      },
    )
  }

  async processWebhook(payload: ChatwootWebhookPayload): Promise<void> {
    logger.debug({ event: payload.event }, 'Webhook recebido do Chatwoot')
    // Delegado para o use case
  }

  async findOrCreateContact(contact: Contact): Promise<{ id: number, contactInboxId?: number }> {
    try {
      // Tentar buscar por número de telefone
      const searchResponse = await this.client.get(`/accounts/${this.accountId}/contacts/search`, {
        params: { q: contact.phoneNumber },
      })

      if (searchResponse.data.payload && searchResponse.data.payload.length > 0) {
        const existing = searchResponse.data.payload[0]
        return {
          id: existing.id,
          contactInboxId: existing.contact_inboxes?.find((ci: any) => ci.inbox.id === this.inboxId)?.id,
        }
      }

      // Criar novo contato
      const createResponse = await this.client.post(`/accounts/${this.accountId}/contacts`, {
        inbox_id: this.inboxId,
        name: contact.pushName || contact.name || contact.phoneNumber,
        phone_number: `+${contact.phoneNumber}`,
        identifier: contact.phoneNumber,
        additional_attributes: {
          company_name: contact.isBusiness ? 'Business' : 'Personal',
        },
      })

      return {
        id: createResponse.data.payload.contact.id,
        contactInboxId: createResponse.data.payload.contact_inboxes?.[0]?.id,
      }
    }
    catch (error) {
      logger.error({ error, phone: contact.phoneNumber }, 'Falha ao buscar/criar contato')
      throw error
    }
  }

  async createConversation(contact: Contact, message: Message): Promise<number> {
    const { id: contactId, contactInboxId } = await this.findOrCreateContact(contact)

    // Se já existe contact_inbox, buscar conversa aberta
    if (contactInboxId) {
      try {
        const convResponse = await this.client.get(
          `/accounts/${this.accountId}/contacts/${contactId}/conversations`,
        )

        const openConv = convResponse.data.payload.find(
          (c: any) => c.inbox_id === this.inboxId && c.status === 'open',
        )

        if (openConv)
          return openConv.id
      }
      catch (error) {
        logger.warn({ error, contactId }, 'Erro ao buscar conversas existentes')
      }
    }

    // Criar nova conversa
    try {
      const response = await this.client.post(`/accounts/${this.accountId}/conversations`, {
        source_id: contact.phoneNumber,
        inbox_id: this.inboxId,
        contact_id: contactId,
        status: 'open',
      })

      return response.data.id
    }
    catch (error) {
      // Se falhar por conversa existente, buscar novamente
      const convResponse = await this.client.get(
        `/accounts/${this.accountId}/contacts/${contactId}/conversations`,
      )
      const conv = convResponse.data.payload.find((c: any) => c.inbox_id === this.inboxId)
      return conv?.id || 0
    }
  }

  async sendMessageToConversation(
    conversationId: number,
    message: Message,
    mediaBuffer?: Buffer,
    mediaFileName?: string,
  ): Promise<{ id: number }> {
    try {
      let attachmentPayload = null

      // Se tem mídia, fazer upload primeiro
      if (mediaBuffer && mediaFileName) {
        attachmentPayload = await this.uploadAttachment(
          conversationId,
          mediaBuffer,
          mediaFileName,
          message.media?.mimeType || 'application/octet-stream',
        )
      }

      const payload: any = {
        content: message.content || (message.type !== 'text' ? `[${message.type}]` : ''),
        message_type: 'incoming', // Sempre incoming do ponto de vista do Chatwoot (vem do cliente)
        private: false,
        content_attributes: {},
      }

      // Adicionar informações de mídia
      if (attachmentPayload) {
        payload.content_attributes.attachments = [{
          id: attachmentPayload.blobId,
          url: attachmentPayload.url,
        }]
      }

      // Para mensagens de áudio, marcar como voice
      if (message.type === 'audio' || message.type === 'voice') {
        payload.content_attributes.voice = true
      }

      const response = await this.client.post(
        `/accounts/${this.accountId}/conversations/${conversationId}/messages`,
        payload,
      )

      return { id: response.data.id }
    }
    catch (error) {
      logger.error({ error, conversationId }, 'Falha ao criar mensagem no Chatwoot')
      throw error
    }
  }

  async uploadAttachment(
    conversationId: number,
    buffer: Buffer,
    fileName: string,
    contentType: string,
  ): Promise<{ blobId: string, url: string }> {
    const form = new FormData()
    form.append('attachments[]', buffer, {
      filename: fileName,
      contentType,
    })

    try {
      const response = await this.client.post(
        `/accounts/${this.accountId}/conversations/${conversationId}/messages`,
        form,
        {
          headers: {
            ...form.getHeaders(),
            'Api-Access-Token': process.env.CHATWOOT_API_TOKEN!,
          },
        },
      )

      const attachment = response.data.attachments?.[0]
      return {
        blobId: attachment?.id || response.data.id,
        url: attachment?.data_url || response.data.attachments?.[0]?.data_url,
      }
    }
    catch (error) {
      logger.error({ error, fileName }, 'Falha no upload de attachment')
      throw error
    }
  }
}
