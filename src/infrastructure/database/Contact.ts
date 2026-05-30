import { PrismaClient, Prisma } from '../../../generated/prisma/client';
import { Contact } from '~/domain/entities/Contact.js';
import { logger } from '~/logger.js';

export class PrismaContactRepository {
  constructor(private prisma: PrismaClient) {}

  async save(contact: Contact): Promise<void> {
    const data: Prisma.ContactCreateInput = {
      id: contact.id,
      phoneNumber: contact.phoneNumber,
      lid: contact.lid,
      name: contact.name,
      pushName: contact.pushName,
      profilePicture: contact.profilePicture,
      isBusiness: contact.isBusiness,
      labels: contact.labels ? JSON.stringify(contact.labels) : null,
      pnMappingSource: contact.pnMappingSource,
      lastMappingUpdate: contact.lastMappingUpdate,
    };

    await this.prisma.contact.upsert({
      where: { id: contact.id },
      update: {
        ...data,
        // Não sobrescrever phoneNumber se já existe e novo é null
        phoneNumber: contact.phoneNumber 
          ? contact.phoneNumber 
          : undefined,
      },
      create: data,
    });
  }

  async findById(id: string): Promise<<Contact | null> {
    const row = await this.prisma.contact.findUnique({ where: { id } });
    return row ? this.toDomain(row) : null;
  }

  async findByPhoneNumber(phoneNumber: string): Promise<<Contact | null> {
    const row = await this.prisma.contact.findFirst({
      where: { phoneNumber },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByLid(lid: string): Promise<<Contact | null> {
    const cleanLid = lid.replace('@lid', '');
    const row = await this.prisma.contact.findFirst({
      where: {
        OR: [
          { id: `${cleanLid}@lid` },
          { lid: cleanLid },
        ],
      },
    });
    return row ? this.toDomain(row) : null;
  }

  async findByAnyId(identifier: string): Promise<<Contact | null> {
    // Tenta por ID direto
    let contact = await this.findById(identifier);
    if (contact) return contact;

    // Tenta por phone
    contact = await this.findByPhoneNumber(identifier.replace(/\D/g, ''));
    if (contact) return contact;

    // Tenta por LID
    contact = await this.findByLid(identifier);
    if (contact) return contact;

    return null;
  }

  async updatePhoneMapping(
    lid: string,
    phoneNumber: string,
    source: 'remoteJidAlt' | 'contactEvent' | 'lidMappingStore' | 'manual' | 'onWhatsApp'
  ): Promise<void> {
    const cleanLid = lid.replace('@lid', '');
    
    await this.prisma.contact.updateMany({
      where: {
        OR: [
          { id: `${cleanLid}@lid` },
          { lid: cleanLid },
        ],
      },
      data: {
        phoneNumber,
        pnMappingSource: source,
        lastMappingUpdate: new Date(),
      },
    });

    logger.info({ lid: cleanLid, phoneNumber, source }, 'Mapeamento LID↔PN atualizado');
  }

  async updateLidMapping(phoneNumber: string, lid: string): Promise<void> {
    await this.prisma.contact.updateMany({
      where: { phoneNumber },
      data: {
        lid: lid.replace('@lid', ''),
        lastMappingUpdate: new Date(),
      },
    });
  }

  async updateNames(id: string, name?: string, pushName?: string): Promise<void> {
    const data: any = {};
    if (name !== undefined) data.name = name;
    if (pushName !== undefined) data.pushName = pushName;
    
    await this.prisma.contact.update({
      where: { id },
      data,
    });
  }

  async updateProfilePicture(id: string, url: string): Promise<void> {
    await this.prisma.contact.update({
      where: { id },
      data: { profilePicture: url },
    });
  }

  async findUnresolvedLids(limit = 100): Promise<<Contact[]> {
    const rows = await this.prisma.contact.findMany({
      where: {
        OR: [
          { id: { endsWith: '@lid' } },
          { lid: { not: null } },
        ],
        phoneNumber: null,
      },
      take: limit,
    });
    return rows.map(r => this.toDomain(r));
  }

  async searchByName(query: string, limit = 20): Promise<<Contact[]> {
    const rows = await this.prisma.contact.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { pushName: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
    });
    return rows.map(r => this.toDomain(r));
  }

  async count(): Promise<number> {
    return this.prisma.contact.count();
  }

  async delete(id: string): Promise<void> {
    await this.prisma.contact.delete({ where: { id } });
  }

  // ===== Mapper =====

  private toDomain(row: any): Contact {
    return {
      id: row.id,
      phoneNumber: row.phoneNumber || undefined,
      lid: row.lid || undefined,
      name: row.name || undefined,
      pushName: row.pushName || undefined,
      profilePicture: row.profilePicture || undefined,
      isBusiness: row.isBusiness,
      labels: row.labels ? JSON.parse(row.labels) : undefined,
      pnMappingSource: row.pnMappingSource || undefined,
      lastMappingUpdate: row.lastMappingUpdate,
    };
  }
}