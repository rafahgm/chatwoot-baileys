import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys'
import type { PrismaClient } from '~/prisma/client'
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys'
import { logger } from '~/logger.js'

const CREDS_KEY = 'creds'

export async function useDatabaseAuthState(prisma: PrismaClient): Promise<{ state: AuthenticationState, saveCreds: () => Promise<void> }> {
  const writeData = async (key: string, value: unknown) => {
    const serialized = JSON.stringify(value, BufferJSON.replacer)
    await prisma.baileysCredential.upsert({
      where: { key },
      update: { value: serialized },
      create: { key, value: serialized },
    })
  }

  const readData = async (key: string): Promise<unknown | null> => {
    const row = await prisma.baileysCredential.findUnique({ where: { key } })
    if (!row)
      return null
    try {
      return JSON.parse(row.value, BufferJSON.reviver)
    }
    catch {
      return null
    }
  }

  const removeData = async (key: string) => {
    await prisma.baileysCredential.delete({ where: { key } }).catch(() => {})
  }

  const rawCreds = await readData(CREDS_KEY)
  const creds = rawCreds || initAuthCreds()

  return {
    state: {
      creds: creds as AuthenticationState['creds'],
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}
          await Promise.all(
            ids.map(async (id) => {
              const value = await readData(`key:${type}:${id}`)
              if (type === 'app-state-sync-key' && value) {
                data[id] = proto.Message.AppStateSyncKeyData.fromObject(value) as any
              }
              else {
                data[id] = value as any
              }
            }),
          )
          return data
        },
        set: async (data: Record<any, any>) => {
          const tasks: Promise<void>[] = []
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id]
              const key = `key:${category}:${id}`
              tasks.push(value ? writeData(key, value) : removeData(key))
            }
          }
          await Promise.all(tasks)
        },
      },
    },
    saveCreds: async () => {
      await writeData(CREDS_KEY, creds)
      logger.debug('Credenciais do Baileys salvas no banco de dados')
    },
  }
}

export async function clearAuthState(prisma: PrismaClient): Promise<void> {
  await prisma.baileysCredential.deleteMany({})
  logger.info('Auth state do Baileys limpo no banco de dados')
}
