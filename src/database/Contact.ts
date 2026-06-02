import { Contact } from '~/domain/entities/Contact.js'
import { logger } from '~/logger.js'
import { Prisma, PrismaClient } from '../../../generated/prisma/client'

export interface Contact {
  id: string
  phoneNumber?: string
  name?: string
  pushName?: string
  profilePicture?: string
  labels?: string[]
}
