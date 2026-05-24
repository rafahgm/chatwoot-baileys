import type { Buffer } from 'node:buffer'
import type { Contact } from '../../domain/entities/Contact.js'
import type { Message } from '../../domain/entities/Message.js'

export interface IBaileysService {
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  isConnected: () => boolean

  sendTextMessage: (to: string, text: string, options?: { quoted?: string }) => Promise<string>
  sendMediaMessage: (to: string, type: 'image' | 'video' | 'audio' | 'document', media: { buffer?: Buffer, url?: string, stream?: ReadableStream }, options?: { caption?: string, ptt?: boolean, fileName?: string, mimeType?: string }) => Promise<string>
  sendVoiceNote: (to: string, audioBuffer: Buffer) => Promise<string>

  onMessage: (handler: (message: Message) => Promise<void>) => () => void
  onConnectionUpdate: (handler: (state: { connected: boolean, qr?: string }) => void) => () => void
  onContactUpdate: (handler: (contact: Contact) => void) => () => void

  getProfilePicture: (jid: string) => Promise<string | undefined>
  formatPhoneToJid: (phone: string) => string
  formatJidToPhone: (jid: string) => string
}
