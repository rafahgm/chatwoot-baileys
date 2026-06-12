import type { Boom } from '@hapi/boom'
import type { AnyMessageContent, AuthenticationCreds, WAMessage } from '@whiskeysockets/baileys'
import type { Buffer } from 'node:buffer'
import type { Contact, Message, PrismaClient } from '~/prisma/client'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  BufferJSON,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  initAuthCreds,
  isJidBroadcast,
  makeCacheableSignalKeyStore,
  makeWASocket,
  proto,
} from '@whiskeysockets/baileys'
import NodeCache from 'node-cache'
import qrcode from 'qrcode-terminal'
import { clearAuthState, useDatabaseAuthState } from '~/auth-state.js'
import { logger } from '~/logger.js'
import { MessageDirection, MessageStatus, MessageType } from '~/prisma/enums'
import { validateHeaderValue } from 'node:http'

export interface MediaMetadata {
  mimeType: string
  fileName?: string
  fileSize?: number
  duration?: number
  caption?: string
  url?: string
  buffer?: Buffer
}

type BaileysMessage = Message & { media?: MediaMetadata }

export interface BaileysState {
  prisma: PrismaClient
  sock: ReturnType<typeof makeWASocket> | null
  authState: Awaited<ReturnType<typeof useDatabaseAuthState>>['state'] | null
  saveCreds: Awaited<ReturnType<typeof useDatabaseAuthState>>['saveCreds'] | null
  msgRetryCounterCache: NodeCache
  connectionState: { connected: boolean, qr?: string }
  isConnecting: boolean
  connectionHandlers: Array<(state: { connected: boolean, qr?: string }) => void>
  messageHandlers: Array<(msg: BaileysMessage) => Promise<void>>
  contactHandlers: Array<(contact: Contact) => void>
}

interface BaileysContactUpsert {
  id: string
  name?: string
  notify?: string
}

const CREDS_KEY = 'creds'

export function createState(prisma: PrismaClient): BaileysState {
  return {
    prisma,
    sock: null,
    authState: null,
    saveCreds: null,
    msgRetryCounterCache: new NodeCache({ stdTTL: 10, checkperiod: 120 }),
    connectionState: { connected: false, qr: undefined },
    isConnecting: false,
    connectionHandlers: [],
    messageHandlers: [],
    contactHandlers: [],
  }
}

export function resolveReconnectStrategy(statusCode: number | undefined): { shouldReconnect: boolean, delay: number, reason: string } {
  if (statusCode === DisconnectReason.loggedOut) {
    return { shouldReconnect: false, delay: 1000, reason: 'loggedOut' }
  }
  if (statusCode === DisconnectReason.restartRequired) {
    return { shouldReconnect: true, delay: 2000, reason: 'restartRequired' }
  }
  return { shouldReconnect: true, delay: 5000, reason: 'connectionClosed' }
}

export function buildConnectionState(update: Partial<BaileysState['connectionState']>): BaileysState['connectionState'] {
  return {
    connected: update.connected ?? false,
    qr: update.qr,
  }
}

export function determineMessageType(msgContent: proto.IMessage): MessageType {
  if (msgContent.conversation || msgContent.extendedTextMessage?.text) {
    return MessageType.TEXT
  }
  if (msgContent.imageMessage)
    return MessageType.IMAGE
  if (msgContent.videoMessage)
    return MessageType.VIDEO
  if (msgContent.audioMessage) {
    return msgContent.audioMessage.ptt ? MessageType.VOICE : MessageType.AUDIO
  }
  if (msgContent.documentMessage)
    return MessageType.DOCUMENT
  if (msgContent.stickerMessage)
    return MessageType.STICKER
  if (msgContent.locationMessage)
    return MessageType.LOCATION
  if (msgContent.contactMessage || msgContent.contactsArrayMessage)
    return MessageType.CONTACT
  return MessageType.UNKNOWN
}

export function extractMessageContent(msgContent: proto.IMessage, type: MessageType): { content?: string, media?: MediaMetadata } {
  let content: string | undefined
  let media: MediaMetadata | undefined

  switch (type) {
    case MessageType.TEXT:
      content = msgContent.conversation || msgContent.extendedTextMessage?.text || undefined
      break
    case MessageType.IMAGE:
      content = msgContent.imageMessage?.caption || undefined
      break
    case MessageType.VIDEO:
      content = msgContent.videoMessage?.caption || undefined
      break
    case MessageType.VOICE:
      if (msgContent.audioMessage) {
        media = {
          duration: msgContent.audioMessage.seconds || undefined,
          mimeType: msgContent.audioMessage.mimetype ?? 'audio/ogg; codecs=opus',
        }
      }
      break
    case MessageType.AUDIO:
      if (msgContent.audioMessage) {
        media = {
          duration: msgContent.audioMessage.seconds || undefined,
          mimeType: msgContent.audioMessage.mimetype ?? 'audio/mp4',
        }
      }
      break
    case MessageType.DOCUMENT:
      content = msgContent.documentMessage?.caption || undefined
      if (msgContent.documentMessage) {
        media = {
          fileName: msgContent.documentMessage.title || undefined,
          mimeType: msgContent.documentMessage.mimetype ?? 'application/pdf',
        }
      }
      break
    case MessageType.STICKER:
      break
    case MessageType.LOCATION:
      content = `Localização ${msgContent.locationMessage?.degreesLatitude}, ${msgContent.locationMessage?.degreesLongitude}`
      break
    case MessageType.CONTACT:
      content = 'Contato compartilhado'
      break
  }

  return { content, media }
}

export function buildMessageFromWAMessage(
  waMsg: WAMessage,
  parsed: { type: MessageType, content?: string, media?: MediaMetadata },
): BaileysMessage {
  const jid = waMsg.key.remoteJid!
  const fromMe = waMsg.key.fromMe || false
  const id = waMsg.key.id!

  return {
    id: `${jid}_${id}`,
    externalId: id,
    direction: fromMe ? MessageDirection.OUTGOING : MessageDirection.INCOMING,
    type: parsed.type,
    from: fromMe ? 'me' : jid,
    to: fromMe ? jid : 'me',
    chatId: jid,
    content: parsed.content ?? null,
    mediaUrl: null,
    mediaMimeType: null,
    mediaFileName: null,
    mediaFileSize: null,
    mediaDuration: null,
    isGroup: jid.endsWith('@g.us'),
    timestamp: new Date((waMsg.messageTimestamp as number) * 1000),
    status: MessageStatus.PENDING,
    quotedMessageId: waMsg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? null,
    error: null,
    chatwootConversationId: null,
    chatwootMessageId: null,
    chatwootContactId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    media: parsed.media,
  } as BaileysMessage
}

export function parseWAMessage(waMsg: WAMessage): BaileysMessage | null {
  const msgContent = waMsg.message
  if (!msgContent)
    return null

  const type = determineMessageType(msgContent)
  const { content, media } = extractMessageContent(msgContent, type)
  return buildMessageFromWAMessage(waMsg, { type, content, media })
}

export function buildTextMessagePayload(text: string, options?: { quoted?: WAMessage }): { text: string } & { quoted?: WAMessage } {
  return { text, ...options }
}

export function buildMediaPayload(
  type: 'image' | 'video' | 'audio' | 'document',
  media: { buffer?: Buffer, url?: string, stream?: ReadableStream },
  options?: { caption?: string, ptt?: boolean, fileName?: string, mimeType?: string },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {}

  if (media.buffer) {
    payload[type] = media.buffer
  }
  else if (media.url) {
    payload[type] = { url: media.url }
  }

  if (type === 'audio' && options?.ptt) {
    payload.ptt = true
    payload.mimeType = options.mimeType || 'audio/ogg; codecs=opus'
  }
  else if (options?.caption && type !== 'audio') {
    payload.caption = options.caption
  }

  if (options?.fileName && type === 'document') {
    payload.fileName = options.fileName
  }

  if (options?.mimeType) {
    payload.mimeType = options.mimeType
  }

  return payload
}

export function resolveMimeType(msgContent: proto.IMessage): string {
  if (msgContent.imageMessage)
    return msgContent.imageMessage.mimetype || 'image/jpeg'
  if (msgContent.videoMessage)
    return msgContent.videoMessage.mimetype || 'video/mp4'
  if (msgContent.audioMessage)
    return msgContent.audioMessage.mimetype || 'audio/ogg'
  if (msgContent.documentMessage)
    return msgContent.documentMessage.mimetype || 'application/pdf'
  if (msgContent.stickerMessage)
    return msgContent.stickerMessage.mimetype || 'image/webp'
  return 'application/octet-stream'
}

export function buildFileName(messageId: string, mimeType: string): string {
  const ext = mimeType.split('/')[1]?.split(';')[0] || 'bin'
  return `${messageId}.${ext}`
}

export function buildMediaMetadata(buffer: Buffer, mimeType: string, fileName: string, _filePath: string): MediaMetadata {
  return {
    mimeType,
    fileName,
    fileSize: buffer.length,
    url: `${process.env.MEDIA_BASE_URL || ''}/${fileName}`,
    buffer,
  }
}

export function formatPhoneToJid(phone: string): string {
  const clean = phone.replace(/\D/g, '')
  return `${clean}@s.whatsapp.net`
}

export function formatJidToPhone(jid: string): string {
  return jid.split('@')[0]!.split(':')[0]!
}

export function buildContactFromUpsert(contact: BaileysContactUpsert): Contact {
  return {
    id: contact.id,
    phoneNumber: contact.id.split('@')[0]!,
    pushName: contact.name || contact.notify || null,
    name: contact.name || null,
    profilePicture: null,
    isBusiness: false,
    labels: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export async function connect(state: BaileysState): Promise<void> {
  if (state.isConnecting || state.connectionState.connected) {
    logger.warn('Conexão já em andamento ou estabelecida. Ignorando chamada.')
    return
  }

  state.isConnecting = true

  try {
    const { version, isLatest } = await fetchLatestBaileysVersion()

    const creds = await getCreds(state.prisma, CREDS_KEY)

    logger.info(`Usando Baileys v${version.join('.')}, latest: ${isLatest}`)

    state.sock = makeWASocket({
      version,
      logger: logger.child({ module: 'baileys' }),
      auth: {
        creds,
        keys: makeCacheableSignalKeyStore(authState.keys, logger.child({ module: 'baileys-keys' })),
      },
      msgRetryCounterCache: state.msgRetryCounterCache,
      generateHighQualityLinkPreview: true,
      syncFullHistory: false,
      markOnlineOnConnect: true,
      keepAliveIntervalMs: 30_000,
      shouldIgnoreJid: jid => isJidBroadcast(jid),
      getMessage: async (_key) => {
        return proto.Message.fromObject({})
      },
    })

    state.sock.ev.on('creds.update', (creds) => {
      saveCreds(state.prisma, CREDS_KEY, creds)
    })

    state.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        state.connectionState = buildConnectionState({ connected: state.connectionState.connected, qr })
        logger.info('QR Code gerado. Escaneie com seu Whatsapp.')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
        const strategy = resolveReconnectStrategy(statusCode)

        logger.error({
          error: lastDisconnect?.error,
          shouldReconnect: strategy.shouldReconnect,
        }, 'Conexão fechada')

        state.connectionState = buildConnectionState({ connected: false })
        state.connectionHandlers.forEach(h => h({ connected: false }))

        state.sock?.end(undefined)
        state.sock = null

        if (statusCode === DisconnectReason.loggedOut) {
          logger.warn('Sessão inválida ou encerrada (401). Apagando credenciais para nova autenticação...')
          try {
            await clearAuthState(state.prisma)
            logger.info('Credenciais do banco apagadas. Escaneie o QR code novamente.')
          }
          catch (err) {
            logger.error(err, 'Erro ao apagar credenciais do banco')
          }

          setTimeout(() => {
            connect(state).catch(err => logger.error(err, 'Erro ao iniciar nova sessão'))
          }, strategy.delay)
        }
        else if (strategy.shouldReconnect) {
          logger.info(`Conexão encerrada pelo servidor (${statusCode}). Tentando reconectar em ${strategy.delay}ms...`)
          setTimeout(() => {
            connect(state).catch(err => logger.error(err, 'Erro ao reconectar'))
          }, strategy.delay)
        }
      }
      else if (connection === 'open') {
        state.connectionState = buildConnectionState({ connected: true })
        state.connectionState.qr = undefined
        logger.info('Conectado ao Whatsapp Web')
        state.connectionHandlers.forEach(h => h({ connected: true }))
      }
    })

    state.sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify')
        return

      for (const waMsg of m.messages) {
        if (waMsg.key.fromMe)
          continue

        try {
          const message = parseWAMessage(waMsg)
          if (message) {
            await Promise.all(state.messageHandlers.map(h => h(message)))
          }
        }
        catch (error) {
          logger.error({ error, waMsg }, 'Erro ao processar mensagem do WhatsApp')
        }
      }
    })

    state.sock.ev.on('contacts.upsert', (contacts) => {
      for (const c of contacts as unknown as BaileysContactUpsert[]) {
        const contact = buildContactFromUpsert(c)
        state.contactHandlers.forEach(h => h(contact))
      }
    })
  }
  finally {
    state.isConnecting = false
  }
}

export async function disconnect(state: BaileysState): Promise<void> {
  await state.sock?.logout()
  state.sock = null
  state.connectionState = buildConnectionState({ connected: false })
}

export function isConnected(state: BaileysState): boolean {
  return state.connectionState.connected
}

export async function sendTextMessage(
  state: BaileysState,
  to: string,
  text: string,
  options?: { quoted?: WAMessage },
): Promise<string> {
  if (!state.sock)
    throw new Error('Socket não conectado')

  const payload = buildTextMessagePayload(text, options)
  const { quoted, ...content } = payload
  const result = await state.sock.sendMessage(to, content, { quoted })

  if (!result)
    throw new Error('Não foi possível enviar a mensagem')
  if (!result.key.id)
    throw new Error('Houve um erro ao enviar a mensagem')

  return result.key.id
}

export async function sendMediaMessage(
  state: BaileysState,
  to: string,
  type: 'image' | 'video' | 'audio' | 'document',
  media: { buffer?: Buffer, url?: string, stream?: ReadableStream },
  options?: { caption?: string, ptt?: boolean, fileName?: string, mimeType?: string },
): Promise<string> {
  if (!state.sock)
    throw new Error('Socket não conectado')

  const messageContent = buildMediaPayload(type, media, options)
  const result = await state.sock.sendMessage(to, messageContent as AnyMessageContent)

  return result!.key.id!
}

export async function sendVoiceNote(state: BaileysState, to: string, audioBuffer: Buffer): Promise<string> {
  return sendMediaMessage(state, to, 'audio', { buffer: audioBuffer }, {
    ptt: true,
    mimeType: 'audio/ogg; codecs=opus',
  })
}

export async function downloadMedia(state: BaileysState, waMsg: WAMessage, type: string): Promise<MediaMetadata | undefined> {
  const buffer = await downloadMediaMessage(waMsg, 'buffer', {}, {
    logger: logger.child({ module: 'baileys-download' }),
    reuploadRequest: state.sock!.updateMediaMessage,
  })

  if (!buffer)
    return undefined

  const mimeType = waMsg.message ? resolveMimeType(waMsg.message) : 'application/octet-stream'
  const uploadsDir = process.env.MEDIA_UPLOAD_DIR || './uploads'
  await mkdir(uploadsDir, { recursive: true })

  const fileName = buildFileName(`${waMsg.key.id!}_${type}`, mimeType)
  const filePath = join(uploadsDir, fileName)

  await writeFile(filePath, buffer)

  return buildMediaMetadata(buffer, mimeType, fileName, filePath)
}

export async function getProfilePicture(state: BaileysState, jid: string): Promise<string | undefined> {
  try {
    const result = await state.sock?.profilePictureUrl(jid, 'image')
    return result || undefined
  }
  catch {
    return undefined
  }
}

export function onMessage(state: BaileysState, handler: (message: BaileysMessage) => Promise<void>): () => void {
  state.messageHandlers.push(handler)
  return () => {
    state.messageHandlers = state.messageHandlers.filter(h => h !== handler)
  }
}

export function onConnectionUpdate(state: BaileysState, handler: (state: { connected: boolean, qr?: string }) => void): () => void {
  state.connectionHandlers.push(handler)
  return () => {
    state.connectionHandlers = state.connectionHandlers.filter(h => h !== handler)
  }
}

export function onContactUpdate(state: BaileysState, handler: (contact: Contact) => void): () => void {
  state.contactHandlers.push(handler)
  return () => {
    state.contactHandlers = state.contactHandlers.filter(h => h !== handler)
  }
}

async function saveCreds(prisma: PrismaClient, key: string, creds: Partial<AuthenticationCreds>) {
  const serialized = JSON.stringify(creds, BufferJSON.replacer)

  await prisma.credential.upsert({
    where: { key },
    update: { value: serialized },
    create: { key, value: serialized }
  })

  logger.debug('Credenciais do Baileys salvas no banco de dados')
}

async function getCreds(prisma: PrismaClient, key: string): Promise<AuthenticationCreds> {
  const row = await prisma.credential.findUnique({where: {key}})

  if(!row) {
    return initAuthCreds()
  }

  return JSON.parse(row.value, BufferJSON.reviver)
}