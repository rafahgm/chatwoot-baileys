import type { IBaileysService } from "../../application/ports/IBaileyService.js";
import {DisconnectReason, fetchLatestBaileysVersion, isJidBroadcast, makeCacheableSignalKeyStore, makeWASocket, proto, useMultiFileAuthState} from '@whiskeysockets/baileys'
import { logger } from "../../config/logger.js";
import NodeCache from 'node-cache';
import {Boom} from '@hapi/boom'

export class BaileysAdapter implements IBaileysService {
    private sock: ReturnType<typeof makeWASocket> | null = null;
    private authState: any;
    private msgRetryCounterCache = new NodeCache({stdTTL: 10, checkperiod: 120});
    private connectionState = {connected: false, qr: undefined as string | undefined};

    private connectionHandlers: Array<(state: any) => void> = [];

    constructor(private authDir: string) {}

    async connect(): Promise<void> {
        const {state, saveCreds} = await useMultiFileAuthState(this.authDir);
        const {version, isLatest} = await fetchLatestBaileysVersion();

        logger.info(`Usando Baileys v${version.join('.')}, latest: ${isLatest}`)

        this.authState = state;

        this.sock = makeWASocket({
            version,
            logger: logger.child({module: 'baileys'}),
            printQRInTerminal: true,
            auth: {
                creds: state.creds,
                keys: makeCacheableSignalKeyStore(state.keys, logger.child({module: 'baileys-keys'}))
            },
            msgRetryCounterCache: this.msgRetryCounterCache,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            markOnlineOnConnect: true,
            keepAliveIntervalMs: 30_000,
            shouldIgnoreJid: (jid) => isJidBroadcast(jid),
            getMessage: async (key) => {
                return proto.Message.fromObject({});
            }
        });

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', (update) => {
            const {connection, lastDisconnect, qr} = update;

            if(qr) {
                this.connectionState.qr = qr;
                logger.info('QR Code gerado. Escaneie com seu Whatsapp.');
            }

            if(connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

                logger.error({
                    error: lastDisconnect?.error,
                    shouldReconnect
                }, 'Conexão fechada')

                this.connectionState.connected = false;
                this.connectionHandlers.forEach(h => h({connected: false}))

                if(shouldReconnect) {
                    setTimeout(() => this.connect, 5000);
                }
            }else if(connection === 'open') {
                this.connectionState.connected = true;
                this.connectionState.qr = undefined;
                logger.info('Conectado ao Whatsapp Web');
                this.connectionHandlers.forEach(h => h({connected: true}))
            }
        })
    }

    async disconnect(): Promise<void> {
        await this.sock?.logout();
        this.sock = null;
        this.connectionState.connected = false;
    }

    isConnected(): boolean {
        return this.connectionState.connected
    }
}