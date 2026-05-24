import type { Contact } from '../entities/Contact.js'

export interface IContactRepository {
  save: (contact: Contact) => Promise<void>
  findByPhone: (phone: string) => Promise<Contact | null>
  findByJid: (jid: string) => Promise<Contact | null>
  update: (contact: Contact) => Promise<void>
}
