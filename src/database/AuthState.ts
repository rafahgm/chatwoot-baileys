import type { PrismaClient } from '@prisma/client'
import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys'
import type { IAuthStateRepository } from '../../../domain/repositories/IAuthStateRepository.js'
import { initAuthCreds } from '@whiskeysockets/baileys'
import { logger } from '../../../config/logger.js'

/**
 * Implementação de auth state em PostgreSQL/SQLite via Prisma.
 * Permite múltiplas réplicas sem volume compartilhado.
 */
export class PrismaAuthStateRepository implements IAuthStateRepository {
  private readonly KEY_PREFIX = 'baileys:auth'

  constructor(private prisma: PrismaClient) {}

  async readState(): Promise<{ state: AuthenticationState, keys: SignalDataTypeMap }> {
    // Ler credenciais
    const credsRow = await this.prisma.authState.findUnique({
      where: { key: `${this.KEY_PREFIX}:creds` },
    })

    const creds = credsRow
      ? JSON.parse(credsRow.value)
      : initAuthCreds()

    // Construir estado
    const state: AuthenticationState = { creds, keys: {} as any }

    // Proxy para keys (lazy loading)
    const keys: SignalDataTypeMap = {
      get: async (type: any, ids: string[]) => {
        const data: { [id: string]: any } = {}
        const rows = await this.prisma.authState.findMany({
          where: {
            key: { in: ids.map(id => `${this.KEY_PREFIX}:key:${type}:${id}`) },
          },
        })
        for (const row of rows) {
          const id = row.key.replace(`${this.KEY_PREFIX}:key:${type}:`, '')
          data[id] = JSON.parse(row.value)
        }
        return data
      },
      set: async (data: any) => {
        for (const type in data) {
          for (const id in data[type]) {
            const value = data[type][id]
            const key = `${this.KEY_PREFIX}:key:${type}:${id}`
            if (value) {
              await this.prisma.authState.upsert({
                where: { key },
                update: { value: JSON.stringify(value) },
                create: { key, value: JSON.stringify(value) },
              })
            }
            else {
              await this.prisma.authState.delete({ where: { key } }).catch(() => {})
            }
          }
        }
      },
    } as any

    return { state, keys }
  }

  async saveCreds(creds: AuthenticationState['creds']): Promise<void> {
    const key = `${this.KEY_PREFIX}:creds`
    await this.prisma.authState.upsert({
      where: { key },
      update: { value: JSON.stringify(creds) },
      create: { key, value: JSON.stringify(creds) },
    })
  }

  async saveKey(type: keyof SignalDataTypeMap, id: string, data: any): Promise<void> {
    const key = `${this.KEY_PREFIX}:key:${type}:${id}`
    await this.prisma.authState.upsert({
      where: { key },
      update: { value: JSON.stringify(data) },
      create: { key, value: JSON.stringify(data) },
    })
  }

  async readKey(type: keyof SignalDataTypeMap, id: string): Promise<any | null> {
    const key = `${this.KEY_PREFIX}:key:${type}:${id}`
    const row = await this.prisma.authState.findUnique({ where: { key } })
    return row ? JSON.parse(row.value) : null
  }

  async deleteKey(type: keyof SignalDataTypeMap, id: string): Promise<void> {
    const key = `${this.KEY_PREFIX}:key:${type}:${id}`
    await this.prisma.authState.delete({ where: { key } }).catch(() => {})
  }

  async readAllKeys(type: keyof SignalDataTypeMap): Promise<{ [id: string]: any }> {
    const prefix = `${this.KEY_PREFIX}:key:${type}:`
    const rows = await this.prisma.authState.findMany({
      where: { key: { startsWith: prefix } },
    })
    const result: { [id: string]: any } = {}
    for (const row of rows) {
      const id = row.key.replace(prefix, '')
      result[id] = JSON.parse(row.value)
    }
    return result
  }

  async hasSession(): Promise<boolean> {
    const count = await this.prisma.authState.count({
      where: { key: `${this.KEY_PREFIX}:creds` },
    })
    return count > 0
  }

  async clear(): Promise<void> {
    await this.prisma.authState.deleteMany({
      where: { key: { startsWith: this.KEY_PREFIX } },
    })
    logger.info('Auth state limpo')
  }
}
