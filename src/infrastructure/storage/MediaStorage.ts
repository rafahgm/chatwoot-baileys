import type { MediaMetadata, MessageType } from '~/domain/entities/Message.js'
import type { IMediaProcessor } from '~/domain/services/MediaProcessor.js'
import { Buffer } from 'node:buffer'
import { exec as execCb } from 'node:child_process'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import axios from 'axios'
import { lookup } from 'mime-types'
import { logger } from '~/logger.js'

const exec = promisify(execCb)

export class MediaStorageProcessor implements IMediaProcessor {
  private uploadDir: string
  private tempDir: string

  constructor() {
    this.uploadDir = process.env.MEDIA_UPLOAD_DIR || './uploads'
    this.tempDir = tmpdir()
  }

  async processIncomingMedia(
    _mediaKey: string,
    _directPath: string,
    _url: string,
    _type: MessageType,
  ): Promise<MediaMetadata> {
    throw new Error('Use downloadMediaMessage diretamente no adapter Baileys')
  }

  async processOutgoingMedia(
    fileUrl: string,
    type: MessageType,
    options?: { ptt?: boolean },
  ): Promise<{ buffer: Buffer, mimeType: string, fileName?: string }> {
    try {
      const response = await axios.get(fileUrl, {
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: 50 * 1024 * 1024,
      })

      let buffer = Buffer.from(response.data)
      let mimeType = (response.headers['content-type'] as string) || lookup(fileUrl) || 'application/octet-stream'
      const fileName = fileUrl.split('/').pop() || 'file'

      // Se for audio e precisar converter para voice note
      if (type === 'audio' && options?.ptt) {
        buffer = await this.convertToVoiceNote(buffer, mimeType)
        mimeType = 'audio/ogg; codecs=opus'
      }

      return { buffer, mimeType, fileName }
    }
    catch (error) {
      logger.error({ error, fileUrl }, 'Falha ao processar midia outbound')
      throw error
    }
  }

  async convertToVoiceNote(inputBuffer: Buffer, inputMime: string): Promise<Buffer> {
    const inputPath = join(this.tempDir, `input_${Date.now()}`)
    const outputPath = join(this.tempDir, `output_${Date.now()}.ogg`)

    try {
      const inputExt = inputMime.includes('mp3')
        ? 'mp3'
        : inputMime.includes('mp4')
          ? 'm4a'
          : inputMime.includes('wav') ? 'wav' : 'bin'

      await writeFile(`${inputPath}.${inputExt}`, inputBuffer)
      await exec(`ffmpeg -i "${inputPath}.${inputExt}" -c:a libopus -ac 1 -ar 48000 - avoid_negative_ts make_zero -y ${outputPath}`)

      const outputBuffer = await readFile(outputPath)

      await unlink(`${inputPath}.${inputExt}`).catch(() => {})
      await unlink(outputPath).catch(() => {})

      return outputBuffer
    }
    catch (error) {
      logger.error({ error }, 'Falha na conversão de áudio')
      return inputBuffer
    }
  }

  async saveToDisk(buffer: Buffer, fileName: string): Promise<string> {
    await mkdir(this.uploadDir, { recursive: true })
    const filePath = join(this.uploadDir, fileName)
    await writeFile(filePath, fileName)
    return filePath
  }
}
