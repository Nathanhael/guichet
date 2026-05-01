// server/services/availability/adapters/redisLiveState.ts
import type { RedisClientType } from 'redis';
import logger from '../../../utils/logger.js';
import type { AgentStatus } from '../index.js';
import type { LiveStatePort, OnlineUserRow } from '../ports.js';

const HASH_PREFIX = 'presence:';
const SET_PREFIX = 'partner:presence:';
const SOCKETS_SUFFIX = ':sockets';
const OFFLINE_AT_PREFIX = 'presence:offline_at:';
const TTL_SECONDS = 86400;

const ATTACH_LUA = `
  local key = KEYS[1]
  local sKey = KEYS[2]
  local sockKey = KEYS[3]
  local userId = ARGV[1]
  local name = ARGV[2]
  local role = ARGV[3]
  local partnerId = ARGV[4]
  local isPlatformOp = ARGV[5]
  local ttl = tonumber(ARGV[6])
  local statusChangedAt = ARGV[7]
  local socketId = ARGV[8]

  if socketId and socketId ~= '' then
    redis.call('SADD', sockKey, socketId)
    redis.call('EXPIRE', sockKey, ttl)
  end

  local exists = redis.call('EXISTS', key)
  if exists == 0 then
    redis.call('HSET', key,
      'userId', userId, 'name', name, 'role', role,
      'partnerId', partnerId, 'isPlatformOperator', isPlatformOp,
      'status', 'online', 'statusChangedAt', statusChangedAt)
  else
    redis.call('HSET', key,
      'userId', userId, 'name', name, 'role', role,
      'partnerId', partnerId, 'isPlatformOperator', isPlatformOp)
  end
  redis.call('EXPIRE', key, ttl)
  redis.call('SADD', sKey, userId)
  redis.call('EXPIRE', sKey, ttl)
  return exists
`;

const DETACH_LUA = `
  local key = KEYS[1]
  local sKey = KEYS[2]
  local sockKey = KEYS[3]
  local userId = ARGV[1]
  local socketId = ARGV[2]

  if redis.call('EXISTS', key) == 0 then
    return -1
  end

  if socketId and socketId ~= '' then
    redis.call('SREM', sockKey, socketId)
  end

  local remaining = redis.call('SCARD', sockKey)
  if remaining <= 0 then
    redis.call('DEL', key, sockKey)
    redis.call('SREM', sKey, userId)
  end
  return remaining
`;

export interface RedisLiveStateDeps {
  redis: RedisClientType | null;
}

export class RedisLiveState implements LiveStatePort {
  constructor(private readonly deps: RedisLiveStateDeps) {}

  private hashKey(partnerId: string, userId: string): string {
    return `${HASH_PREFIX}${partnerId}:${userId}`;
  }
  private socketsKey(partnerId: string, userId: string): string {
    return `${HASH_PREFIX}${partnerId}:${userId}${SOCKETS_SUFFIX}`;
  }
  private setKey(partnerId: string): string {
    return `${SET_PREFIX}${partnerId}`;
  }
  private offlineAtKey(partnerId: string, userId: string): string {
    return `${OFFLINE_AT_PREFIX}${partnerId}:${userId}`;
  }

  async upsertIdentity(input: {
    partnerId: string; userId: string; name: string; role: string;
    isPlatformOperator: boolean; initialStatus: AgentStatus;
  }): Promise<void> {
    if (!this.deps.redis) return;
    try {
      await this.deps.redis.eval(ATTACH_LUA, {
        keys: [
          this.hashKey(input.partnerId, input.userId),
          this.setKey(input.partnerId),
          this.socketsKey(input.partnerId, input.userId),
        ],
        arguments: [
          input.userId, input.name, input.role, input.partnerId,
          input.isPlatformOperator ? '1' : '0', String(TTL_SECONDS),
          new Date().toISOString(), '',
        ],
      });
    } catch (err) {
      logger.error({ err, userId: input.userId }, '[availability/RedisLiveState] upsertIdentity failed');
    }
  }

  async attachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }> {
    if (!this.deps.redis) return { socketCount: 0 };
    try {
      await this.deps.redis.sAdd(this.socketsKey(partnerId, userId), socketId);
      await this.deps.redis.expire(this.socketsKey(partnerId, userId), TTL_SECONDS);
      const count = await this.deps.redis.sCard(this.socketsKey(partnerId, userId));
      return { socketCount: count };
    } catch (err) {
      logger.error({ err, userId }, '[availability/RedisLiveState] attachSocket failed');
      return { socketCount: 0 };
    }
  }

  async detachSocket(partnerId: string, userId: string, socketId: string): Promise<{ socketCount: number }> {
    if (!this.deps.redis) return { socketCount: 0 };
    try {
      const result = await this.deps.redis.eval(DETACH_LUA, {
        keys: [
          this.hashKey(partnerId, userId),
          this.setKey(partnerId),
          this.socketsKey(partnerId, userId),
        ],
        arguments: [userId, socketId],
      }) as number;
      return { socketCount: Math.max(0, result) };
    } catch (err) {
      logger.error({ err, userId }, '[availability/RedisLiveState] detachSocket failed');
      return { socketCount: 0 };
    }
  }

  async socketCount(partnerId: string, userId: string): Promise<number> {
    if (!this.deps.redis) return 0;
    try {
      return await this.deps.redis.sCard(this.socketsKey(partnerId, userId));
    } catch {
      return 0;
    }
  }

  async readStatus(partnerId: string, userId: string): Promise<AgentStatus | null> {
    if (!this.deps.redis) return null;
    try {
      const v = await this.deps.redis.hGet(this.hashKey(partnerId, userId), 'status');
      return (v as AgentStatus | null) ?? null;
    } catch {
      return null;
    }
  }

  async writeStatus(partnerId: string, userId: string, status: AgentStatus): Promise<void> {
    if (!this.deps.redis) return;
    const exists = await this.deps.redis.hExists(this.hashKey(partnerId, userId), 'userId');
    if (!exists) return;
    await this.deps.redis.hSet(this.hashKey(partnerId, userId), {
      status, statusChangedAt: new Date().toISOString(),
    });
  }

  async markOfflineAt(partnerId: string, userId: string, at: Date): Promise<void> {
    if (!this.deps.redis) return;
    try {
      await this.deps.redis.set(
        this.offlineAtKey(partnerId, userId),
        at.toISOString(),
        { EX: TTL_SECONDS },
      );
    } catch (err) {
      logger.error({ err, userId }, '[availability/RedisLiveState] markOfflineAt failed');
    }
  }

  async readOfflineAt(partnerId: string, userId: string): Promise<Date | null> {
    if (!this.deps.redis) return null;
    try {
      const v = await this.deps.redis.get(this.offlineAtKey(partnerId, userId));
      if (!v) return null;
      const d = new Date(v);
      return Number.isFinite(d.getTime()) ? d : null;
    } catch {
      return null;
    }
  }

  async clearOfflineAt(partnerId: string, userId: string): Promise<void> {
    if (!this.deps.redis) return;
    try {
      await this.deps.redis.del(this.offlineAtKey(partnerId, userId));
    } catch (err) {
      logger.error({ err, userId }, '[availability/RedisLiveState] clearOfflineAt failed');
    }
  }

  async listOnline(partnerId: string): Promise<OnlineUserRow[]> {
    if (!this.deps.redis) return [];
    try {
      const memberIds = await this.deps.redis.sMembers(this.setKey(partnerId));
      if (memberIds.length === 0) return [];
      const pipeline = this.deps.redis.multi();
      for (const uid of memberIds) {
        pipeline.hGetAll(this.hashKey(partnerId, uid));
      }
      const results = await pipeline.exec();
      const out: OnlineUserRow[] = [];
      for (const r of results) {
        const data = r as unknown as Record<string, string>;
        if (data && data.userId) {
          out.push({
            userId: data.userId,
            name: data.name,
            role: data.role,
            status: data.status ?? 'online',
            isPlatformOperator: data.isPlatformOperator === '1',
          });
        }
      }
      return out;
    } catch (err) {
      logger.error({ err, partnerId }, '[availability/RedisLiveState] listOnline failed');
      return [];
    }
  }

  async flushAll(): Promise<void> {
    if (!this.deps.redis) return;
    try {
      let deleted = 0;
      let cursor: string | number = 0;
      do {
        const r = await this.deps.redis.scan(String(cursor), { MATCH: `${HASH_PREFIX}*`, COUNT: 200 });
        cursor = r.cursor;
        if (r.keys.length > 0) {
          await this.deps.redis.del(r.keys);
          deleted += r.keys.length;
        }
      } while (Number(cursor) !== 0);
      cursor = 0;
      do {
        const r = await this.deps.redis.scan(String(cursor), { MATCH: `${SET_PREFIX}*`, COUNT: 200 });
        cursor = r.cursor;
        if (r.keys.length > 0) {
          await this.deps.redis.del(r.keys);
          deleted += r.keys.length;
        }
      } while (Number(cursor) !== 0);
      logger.info({ deleted }, '[availability] Startup flush complete');
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, '[availability] flushAll failed');
    }
  }
}
