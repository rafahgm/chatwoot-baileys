import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '~/prisma/client'

export function generateClient() {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL não definido')

  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL })
  return new PrismaClient({ adapter })
}
