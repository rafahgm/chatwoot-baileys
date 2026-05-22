export enum MessageType {
    TEXT = 'text',
    IMAGE = 'image',
    VIDEO = 'video',
    AUDIO = 'audio',
    DOCUMENTO = 'document',
    VOICE = 'voice',
    STICKER = 'sticker',
    LOCATION = 'location',
    CONTACT = 'contact',
    UNKNOWN = 'unknown'
}

export enum MessageDirection {
    INBOUND = 'inbound', // Whatsapp -> Chatwoot,
    OUTBOUND = 'outbound' // Chatwoot -> Whatsapp
}

export interface MediaMetadata {
    mimeType: string;
    fileName?: string;
    fileSize?: number;
    duration?: number;
    caption?: string;
    url?: string;
    buffer?: Buffer;
}

export interface Message {
    id: string;
    externalId: string;
    direction: MessageDirection;
    type: MessageType;

    from: string;
    to: string;
    chatId: string;

    content?: string;
    media?: MediaMetadata;

    isGroup?: boolean;
    groupSubject?: string;
    quotedMessageId?: string;
    timestamp: Date;

    chatwootConversationId?: number;
    chatwootMessageId?: number;
    chatwootContactId?: number;

    status: 'pending'|'sent'|'delivered'|'read'|'failed';
    error?: string;
}