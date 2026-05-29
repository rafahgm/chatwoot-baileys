import type { Buffer } from 'node:buffer'
import type { MediaMetadata, MessageType } from '~/domain/entities/Message.js'

export interface IMediaProcessor {
  /**
   * Processa mídia recebida do WhatsApp para envio ao Chatwoot
   * - Faz download do buffer
   * - Detecta mime type
   * - Converte áudio OGG/Opus para MP3 se necessário
   * - Gera thumbnail se necessário
   */
  processIncomingMedia: (
    mediaKey: string,
    directPath: string,
    url: string,
    type: MessageType,
  ) => Promise<MediaMetadata>

  /**
   * Processa mídia vinda do Chatwoot para envio ao WhatsApp
   * - Valida tamanho e tipo
   * - Converte áudio para OGG/Opus (formato WhatsApp voice)
   * - Retorna buffer pronto para envio
   */
  processOutgoingMedia: (
    fileUrl: string,
    type: MessageType,
    options?: { ptt?: boolean },
  ) => Promise<{ buffer: Buffer, mimeType: string, fileName?: string }>

  /**
   * Converte áudio para formato compatível com WhatsApp voice notes
   * ffmpeg -i input.mp3 -c:a libopus -ac 1 -ar 48000 output.ogg
   */
  convertToVoiceNote: (inputBuffer: Buffer, inputMime: string) => Promise<Buffer>
}
