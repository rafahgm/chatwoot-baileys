import type { RedisClientType } from 'redis'
import { createClient } from 'redis'
import { logger } from './logger.js'

export type CacheClient = RedisClientType

export async function createCache(url?: string): Promise<CacheClient> {
  const client = createClient({
    url: url || process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
      reconnectStrategy: retries => Math.min(retries * 50, 500),
    },
  })

  client.on('error', err => logger.error({ err }, 'Redis error'))
  client.on('connect', () => logger.info('Redis conectado'))

  await client.connect()
  return client
}

export async function disconnectCache(client: CacheClient): Promise<void> {
  await client.quit()
}

export async function set(client: CacheClient, key: string, value: string, ttlSeconds?: number): Promise<void> {
  if (ttlSeconds) {
    await client.setEx(key, ttlSeconds, value)
  }
  else {
    await client.set(key, value)
  }
}

export async function get(client: CacheClient, key: string): Promise<string | null> {
  return client.get(key)
}

export async function getAndDelete(client: CacheClient, key: string): Promise<string | null> {
  const value = await client.get(key)
  if (value)
    await client.del(key)
  return value
}

export async function del(client: CacheClient, key: string): Promise<void> {
  await client.del(key)
}

export async function exists(client: CacheClient, key: string): Promise<boolean> {
  return (await client.exists(key)) === 1
}

export async function increment(client: CacheClient, key: string, amount = 1): Promise<number> {
  return client.incrBy(key, amount)
}

export async function expire(client: CacheClient, key: string, ttlSeconds: number): Promise<void> {
  await client.expire(key, ttlSeconds)
}

export async function mget(client: CacheClient, keys: string[]): Promise<(string | null)[]> {
  return client.mGet(keys)
}

export async function mset(client: CacheClient, entries: Record<string, string>): Promise<void> {
  const args = Object.entries(entries).flat()
  await client.mSet(args as [string, string, ...string[]])
}

export async function clearPrefix(client: CacheClient, prefix: string): Promise<void> {
  const keys = await client.keys(`${prefix}*`)
  if (keys.length > 0) {
    await client.del(keys)
  }
}

export async function publish(client: CacheClient, channel: string, message: string): Promise<void> {
  await client.publish(channel, message)
}

export async function subscribe(client: CacheClient, channel: string, handler: (message: string) => void): Promise<void> {
  const subscriber = client.duplicate()
  await subscriber.connect()
  await subscriber.subscribe(channel, message => handler(message))
}
