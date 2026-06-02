import type { RedisClientType } from 'redis'
import type { ICacheRepository } from '../../domain/repositories/ICacheRepository.js'
import { createClient } from 'redis'
import { logger } from '../../config/logger.js'

export class RedisCacheRepository implements ICacheRepository {
  private client: RedisClientType

  constructor(url?: string) {
    this.client = createClient({
      url: url || process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        reconnectStrategy: retries => Math.min(retries * 50, 500),
      },
    })

    this.client.on('error', err => logger.error({ err }, 'Redis error'))
    this.client.on('connect', () => logger.info('Redis conectado'))
  }

  async connect(): Promise<void> {
    await this.client.connect()
  }

  async disconnect(): Promise<void> {
    await this.client.quit()
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setEx(key, ttlSeconds, value)
    }
    else {
      await this.client.set(key, value)
    }
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key)
  }

  async getAndDelete(key: string): Promise<string | null> {
    const value = await this.client.get(key)
    if (value)
      await this.client.del(key)
    return value
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key)
  }

  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1
  }

  async increment(key: string, amount = 1): Promise<number> {
    return this.client.incrBy(key, amount)
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds)
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    return this.client.mGet(keys)
  }

  async mset(entries: Record<string, string>): Promise<void> {
    const args = Object.entries(entries).flat()
    await this.client.mSet(args as [string, string, ...string[]])
  }

  async clearPrefix(prefix: string): Promise<void> {
    const keys = await this.client.keys(`${prefix}*`)
    if (keys.length > 0) {
      await this.client.del(keys)
    }
  }

  async publish(channel: string, message: string): Promise<void> {
    await this.client.publish(channel, message)
  }

  async subscribe(channel: string, handler: (message: string) => void): Promise<void> {
    const subscriber = this.client.duplicate()
    await subscriber.connect()
    await subscriber.subscribe(channel, message => handler(message))
  }
}
