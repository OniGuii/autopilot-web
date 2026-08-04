import {
  Injectable,
  Logger,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';

const UNLOCK_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly client: Redis;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>('redis.host', 'localhost');
    const port = this.config.get<number>('redis.port', 6379);
    const password = this.config.get<string>('redis.password') || undefined;

    this.client = new Redis({
      host,
      port,
      password,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
    });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      if (this.client.status !== 'end') {
        await this.client.quit();
      }
    } catch {
      this.client.disconnect();
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensureConnected();
      const result = await this.client.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  /**
   * Distributed lock: SET key token PX ttl NX.
   * @returns lock token when acquired, null when already held.
   */
  async tryAcquireLock(key: string, ttlMs: number): Promise<string | null> {
    try {
      await this.ensureConnected();
      const token = randomUUID();
      const result = await this.client.set(key, token, 'PX', ttlMs, 'NX');
      return result === 'OK' ? token : null;
    } catch (err) {
      this.logger.warn(
        `tryAcquireLock failed: ${err instanceof Error ? err.message : err}`,
      );
      throw new ServiceUnavailableException(
        'Redis unavailable for distributed lock',
      );
    }
  }

  /** Release only if token matches (safe unlock). */
  async releaseLock(key: string, token: string): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.eval(UNLOCK_LUA, 1, key, token);
    } catch (err) {
      this.logger.warn(
        `releaseLock failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Soft-fail get — returns null on Redis errors. */
  async get(key: string): Promise<string | null> {
    try {
      await this.ensureConnected();
      return await this.client.get(key);
    } catch (err) {
      this.logger.warn(
        `redis get failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  /** Soft-fail set with TTL seconds. */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    try {
      await this.ensureConnected();
      await this.client.set(key, value, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `redis set failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Soft-fail delete. */
  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.ensureConnected();
      await this.client.del(...keys);
    } catch (err) {
      this.logger.warn(
        `redis del failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Soft-fail SCAN + DEL for prefix patterns (e.g. autopilot:auth:access:userId:*). */
  async deleteByPattern(pattern: string): Promise<number> {
    try {
      await this.ensureConnected();
      let cursor = '0';
      let removed = 0;
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length > 0) {
          removed += await this.client.del(...keys);
        }
      } while (cursor !== '0');
      return removed;
    } catch (err) {
      this.logger.warn(
        `redis deleteByPattern failed: ${err instanceof Error ? err.message : err}`,
      );
      return 0;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (this.client.status === 'ready') return;
    if (
      this.client.status === 'connecting' ||
      this.client.status === 'connect'
    ) {
      await new Promise<void>((resolve, reject) => {
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          reject(err);
        };
        const cleanup = () => {
          this.client.off('ready', onReady);
          this.client.off('error', onError);
        };
        this.client.once('ready', onReady);
        this.client.once('error', onError);
      });
      return;
    }
    await this.client.connect();
  }
}
