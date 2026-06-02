import type { Boom } from '@hapi/boom'
import type { WAMessage } from '@whiskeysockets/baileys'
import type { Buffer } from 'node:buffer'
import type { Contact } from '~/domain/entities/Contact.js'
import type { MediaMetadata, Message } from '~/domain/entities/Message.js'
import { rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, isJidBroadcast, makeCacheableSignalKeyStore, makeWASocket, proto, useMultiFileAuthState } from '@whiskeysockets/baileys'
import NodeCache from 'node-cache'
import qrcode from 'qrcode-terminal'
import { MessageDirection, MessageType } from '~/domain/entities/Message.js'
import { logger } from '~/logger.js'

export class BaileysAdapter {
  private sock: ReturnType<typeof makeWASocket> | null = null
  private authState: any
  private msgRetryCounterCache = new NodeCache({ stdTTL: 10, checkperiod: 120 })
  private connectionState = { connected: false, qr: undefined as string | undefined }
  private isConnecting = false

  // Handlers
  private connectionHandlers: Array<(state: any) => void> = []
  private messageHandlers: Array<(msg: Message) => Promise<void>> = []
  private contactHandlers: Array<(contact: Contact) => void> = []

  constructor(private authDir: string) {}

  async connect(): Promise<void> {
    if (this.isConnecting || this.connectionState.connected) {
      logger.warn('Conexão já em andamento ou estabelecida. Ignorando chamada.')
      return
    }
    this.isConnecting = true

    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir)
      const { version, isLatest } = await fetchLatestBaileysVersion()

      logger.info(`Usando Baileys v${version.join('.')}, latest: ${isLatest}`)

      this.authState = state

      this.sock = makeWASocket({
        version,
        logger: logger.child({ module: 'baileys' }),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger.child({ module: 'baileys-keys' })),
        },
        msgRetryCounterCache: this.msgRetryCounterCache,
        generateHighQualityLinkPreview: true,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        keepAliveIntervalMs: 30_000,
        shouldIgnoreJid: jid => isJidBroadcast(jid),
        getMessage: async (_key) => {
          return proto.Message.fromObject({})
        },
      })

      this.sock.ev.on('creds.update', saveCreds)

      this.sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
          this.connectionState.qr = qr
          qrcode.generate(qr, { small: true })
          logger.info('QR Code gerado. Escaneie com seu Whatsapp.')
        }

        if (connection === 'close') {
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut

          logger.error({
            error: lastDisconnect?.error,
            shouldReconnect,
          }, 'Conexão fechada')

          this.connectionState.connected = false
          this.connectionHandlers.forEach(h => h({ connected: false }))

          // Sempre limpa o socket antigo para evitar vazamento de listeners
          this.sock?.end(undefined)
          this.sock = null

          if (statusCode === DisconnectReason.loggedOut) {
            logger.warn('Sessão inválida ou encerrada (401). Apagando credenciais para nova autenticação...')
            try {
              rmSync(this.authDir, { recursive: true, force: true })
              logger.info('Credenciais locais apagadas. Escaneie o QR code novamente.')
            }
            catch (err) {
              logger.error(err, 'Erro ao apagar credenciais locais')
            }

            setTimeout(() => {
              this.connect().catch(err => logger.error(err, 'Erro ao iniciar nova sessão'))
            }, 1000)
          }
          else if (shouldReconnect) {
            const delay = statusCode === DisconnectReason.restartRequired ? 2000 : 5000
            logger.info(`Conexão encerrada pelo servidor (${statusCode}). Tentando reconectar em ${delay}ms...`)
            setTimeout(() => {
              this.connect().catch(err => logger.error(err, 'Erro ao reconectar'))
            }, delay)
          }
        }
        else if (connection === 'open') {
          this.connectionState.connected = true
          this.connectionState.qr = undefined
          logger.info('Conectado ao Whatsapp Web')
          this.connectionHandlers.forEach(h => h({ connected: true }))
        }
      })

      // Eventos de mensagens
      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify')
          return

        for (const waMsg of m.messages) {
        // Ignorar mensagens enviadas por nós mesmos
          if (waMsg.key.fromMe)
            continue

          try {
            const message = await this.parseWAMessage(waMsg)
            if (message) {
              await Promise.all(this.messageHandlers.map(h => h(message)))
            }
          }
          catch (error) {
            logger.error({ error, waMsg }, 'Erro ao processar mensagem do WhatsApp')
          }
        }
      })

      // evento de contatos
      this.sock.ev.on('contacts.upsert', (contacts) => {
        for (const c of contacts) {
          const contact: Contact = {
            id: c.id,
            phoneNumber: c.id.split('@')[0],
            pushName: c.name || c.notify,
            name: c.name,
          }
          this.connectionHandlers.forEach(h => h(contact))
        }
      })
    }
    finally {
      this.isConnecting = false
    }
  }

  async disconnect(): Promise<void> {
    await this.sock?.logout()
    this.sock = null
    this.connectionState.connected = false
  }

  isConnected(): boolean {
    return this.connectionState.connected
  }

  async sendTextMessage(to: string, text: string, options?: { quoted?: WAMessage }): Promise<string> {
    if (!this.sock)
      throw new Error('Socket não conectado')

    const result = await this.sock.sendMessage(to, { text }, { quoted: options?.quoted })

    if (!result)
      throw new Error('Não foi possível enviar a mensagem')
    if (!result.key.id)
      throw new Error('Houve um erro ao enviar a mensagem')

    return result.key.id
  }

  async sendMediaMessage(
    to: string,
    type: 'image' | 'video' | 'audio' | 'document',
    media: { buffer?: Buffer, url?: string, stream?: ReadableStream },
    options?: { caption?: string, ptt?: boolean, fileName?: string, mimeType?: string },
  ): Promise<string> {
    if (!this.sock)
      throw new Error('Socket não conectado')

    const messageContent: any = {}

    if (media.buffer) {
      messageContent[type] = media.buffer
    }
    else if (media.url) {
      messageContent[type] = { url: media.url }
    }

    if (type === 'audio' && options?.ptt) {
      messageContent.ptt = true
      messageContent.mimeType = options.mimeType || 'audio/ogg; codecs=opus'
    }
    else if (options?.caption && type !== 'audio') {
      messageContent.caption = options.caption
    }

    if (options?.fileName && type === 'document') {
      messageContent.fileName = options.fileName
    }

    if (options?.mimeType) {
      messageContent.mimeType = options.mimeType
    }

    const result = await this.sock.sendMessage(to, messageContent)
    return result!.key.id!
  }

  async sendVoiceNote(to: string, audioBuffer: Buffer): Promise<string> {
    return this.sendMediaMessage(to, 'audio', { buffer: audioBuffer }, {
      ptt: true,
      mimeType: 'audio/ogg; codecs=opus',
    })
  }

  private async parseWAMessage(waMsg: WAMessage): Promise<Message | null> {
    const msgContent = waMsg.message
    if (!msgContent)
      return null

    const jid = waMsg.key.remoteJid!
    const fromMe = waMsg.key.fromMe || false
    const id = waMsg.key.id!
    const timestamp = new Date((waMsg.messageTimestamp as number) * 1000)

    let type: MessageType = MessageType.UNKNOWN
    let content: string | undefined
    let media: MediaMetadata | undefined

    if (msgContent.conversation || msgContent.extendedTextMessage?.text) {
      type = MessageType.TEXT
      content = msgContent.conversation || msgContent.extendedTextMessage?.text || undefined
    }
    else if (msgContent.imageMessage) {
      type = MessageType.IMAGE
      content = msgContent.imageMessage.caption || undefined
      // TODO: Fazer download da media
    }
    else if (msgContent.videoMessage) {
      type = MessageType.VIDEO
      content = msgContent.videoMessage.caption || undefined
    }
    else if (msgContent.audioMessage) {
      type = msgContent.audioMessage.ptt ? MessageType.VOICE : MessageType.AUDIO
      // TODO: fazer download da midia
      if (media) {
        media.duration = msgContent.audioMessage.seconds || undefined
      }
    }
    else if (msgContent.documentMessage) {
      type = MessageType.DOCUMENTO
      content = msgContent.documentMessage.caption || undefined
      // TODO: Fazer download da midia
      if (media) {
        media.fileName = msgContent.documentMessage.title || undefined
      }
    }
    else if (msgContent.stickerMessage) {
      type = MessageType.STICKER
      // TODO: Fazer download da midia
    }
    else if (msgContent.locationMessage) {
      type = MessageType.LOCATION
      content = `Localização ${msgContent.locationMessage.degreesLatitude}, ${msgContent.locationMessage.degreesLatitude}`
    }
    else if (msgContent.contactMessage || msgContent.contactsArrayMessage) {
      type = MessageType.CONTACT
      content = 'Contato compartilhado'
    }

    return {
      id: `${jid}_${id}`,
      externalId: id,
      direction: fromMe ? MessageDirection.OUTBOUND : MessageDirection.INBOUND,
      type,
      from: fromMe ? 'me' : jid,
      to: fromMe ? jid : 'me',
      chatId: jid,
      content,
      media,
      isGroup: jid.endsWith('@g.us'),
      timestamp,
      status: 'pending',
      quotedMessageId: waMsg.message?.extendedTextMessage?.contextInfo?.stanzaId || undefined,
    }
  }

  private async downloadMedia(waMsg: WAMessage, type: string): Promise<MediaMetadata | undefined> {
    const buffer = await downloadMediaMessage(waMsg, 'buffer', {}, {
      logger: logger.child({ module: 'baileys-download' }),
      reuploadRequest: this.sock!.updateMediaMessage,
    })

    if (!buffer)
      return undefined

    let mimeType = 'application/octet-stream'
    const msgContent = waMsg.message

    if (msgContent?.imageMessage)
      mimeType = msgContent.imageMessage.mimetype || 'image/jpeg'
    else if (msgContent?.videoMessage)
      mimeType = msgContent.videoMessage.mimetype || 'video/mp4'
    else if (msgContent?.audioMessage)
      mimeType = msgContent.audioMessage.mimetype || 'audio/ogg'
    else if (msgContent?.documentMessage)
      mimeType = msgContent.documentMessage.mimetype || 'application/pdf'
    else if (msgContent?.stickerMessage)
      mimeType = msgContent.stickerMessage.mimetype || 'image/webp'

    const uploadsDir = process.env.MEDIA_UPLOAD_DIR || './uploads'
    await mkdir(uploadsDir, { recursive: true })

    const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin'
    const fileName = `${waMsg.key.id}_${type}.${ext}`
    const filePath = join(uploadsDir, fileName)

    await writeFile(filePath, buffer)

    return {
      mimeType,
      fileName,
      fileSize: buffer.length,
      url: `${process.env.MEDIA_BASE_URL || ''}/${fileName}`,
      buffer,
    }
  }

  formatPhoneToJid(phone: string) {
    const clean = phone.replace(/\D/g, '')
    return `${clean}@s.whatsapp.net`
  }

  formatJidToPhone(jid: string) {
    return jid.split('@')[0]!.split(':')[0]!
  }

  async getProfilePicture(jid: string): Promise<string | undefined> {
    try {
      const result = await this.sock?.profilePictureUrl(jid, 'image')
      return result || undefined
    }
    catch {
      return undefined
    }
  }

  onMessage(handler: (message: Message) => Promise<void>): () => void {
    this.messageHandlers.push(handler)
    return () => {
      this.messageHandlers = this.messageHandlers.filter(h => h !== handler)
    }
  }

  onConnectionUpdate(handler: (state: { connected: boolean, qr?: string }) => void) {
    this.connectionHandlers.push(handler)
    return () => {
      this.connectionHandlers = this.connectionHandlers.filter(h => h !== handler)
    }
  }

  onContactUpdate(handler: (contact: Contact) => void) {
    this.contactHandlers.push(handler)
    return () => {
      this.contactHandlers = this.contactHandlers.filter(h => h !== handler)
    }
  }
}
