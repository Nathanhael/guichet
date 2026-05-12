// server/services/availability/adapters/redisLiveState.ts
import type { RedisClientType } from 'redis';
import type { LiveStatePort } from '../ports.js';
import type { AgentStatus, OnlineUser } from '../types.js';

const HASH_PREFIX = 'presence:';
const SET_PREFIX = 'partner:presence:';
const SOCKETS_SUFFIX = ':sockets';
const OFFLINE_AT_PREFIX = 'presence:offline_at:';
const LAST_STATUS_PREFIX = 'presence:last_status:';
const TTL_SECONDS = 86400;

function hashKey(partnerId: string, userId: string) { return `${HASH_PREFIX}${partnerId}:${userId}`; }
function socketsKey(partnerId: string, userId: string) { return `${HASH_PREFIX}${partnerId}:${userId}${SOCKETS_SUFFIX}`; }
function setKey(partnerId: string) { return `${SET_PREFIX}${partnerId}`; }
function offlineAtKey(partnerId: string, userId: string) { return `${OFFLINE_AT_PREFIX}${partnerId}:${userId}`; }
function lastStatusKey(partnerId: string, userId: string) { return `${LAST_STATUS_PREFIX}${partnerId}:${userId}`; }

interface Deps {
  redis: RedisClientType | null;
  logger: { error: (obj: unknown, msg?: string) => void; debug: (obj: unknown, msg?: string) => void };
}

export class RedisLiveState implements LiveStatePort {
  constructor(private deps: Deps) {}

  private get r() { return this.deps.redis; }

  async attachSocket(partnerId: string, userId: string, socketId: string) {
    if (!this.r) return { socketCount: 0 };
    try {
      await this.r.sAdd(socketsKey(partnerId, userId), socketId);
      await this.r.expire(socketsKey(partnerId, userId), TTL_SECONDS);
      const socketCount = await this.r.sCard(socketsKey(partnerId, userId));
      return { socketCount };
    } catch (err) {
      this.deps.logger.error({ err, userId }, 'RedisLiveState.attachSocket failed');
      throw err;
    }
  }

  async detachSocket(partnerId: string, userId: string, socketId: string) {
    if (!this.r) return { socketCount: 0 };
    // Lua: remove socketId from sockets set; if SCARD reaches 0, drop hash + sockets set + partner-set membership.
    // last_status is intentionally NOT touched — it persists across full disconnect to enable status restoration on reconnect.
    const lua = `
      local key = KEYS[1]
      local sKey = KEYS[2]
      local sockKey = KEYS[3]
      local userId = ARGV[1]
      local socketId = ARGV[2]
      if redis.call('EXISTS', key) == 0 then return 0 end
      if socketId and socketId ~= '' then redis.call('SREM', sockKey, socketId) end
      local remaining = redis.call('SCARD', sockKey)
      if remaining <= 0 then
        redis.call('DEL', key, sockKey)
        redis.call('SREM', sKey, userId)
        return 0
      end
      return remaining
    `;
    try {
      const remaining = await this.r.eval(lua, {
        keys: [hashKey(partnerId, userId), setKey(partnerId), socketsKey(partnerId, userId)],
        arguments: [userId, socketId],
      }) as number;
      return { socketCount: Number(remaining) || 0 };
    } catch (err) {
      this.deps.logger.error({ err, userId }, 'RedisLiveState.detachSocket failed');
      throw err;
    }
  }

  async socketCount(partnerId: string, userId: string) {
    if (!this.r) return 0;
    return this.r.sCard(socketsKey(partnerId, userId));
  }

  async upsertIdentity(input: { partnerId: string; userId: string; role: string; name: string; isPlatformOperator: boolean }) {
    if (!this.r) return;
    // Lua: on first-ever identify (hash missing), seed status from last_status (or 'online' if absent) — this is what
    // gives us the "preserve status across full disconnect" contract that legacy presence.ts lacked. On reconnect with
    // hash still alive (TTL not expired), preserve current status by NOT writing the status field.
    const lua = `
      local key = KEYS[1]
      local sKey = KEYS[2]
      local lastStatusKey = KEYS[3]
      local userId = ARGV[1]
      local name = ARGV[2]
      local role = ARGV[3]
      local partnerId = ARGV[4]
      local isPlatformOp = ARGV[5]
      local ttl = tonumber(ARGV[6])
      local statusChangedAt = ARGV[7]
      local exists = redis.call('EXISTS', key)
      if exists == 0 then
        local seedStatus = redis.call('GET', lastStatusKey) or 'online'
        redis.call('HSET', key,
          'userId', userId, 'name', name, 'role', role, 'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp, 'status', seedStatus, 'statusChangedAt', statusChangedAt)
      else
        redis.call('HSET', key,
          'userId', userId, 'name', name, 'role', role, 'partnerId', partnerId,
          'isPlatformOperator', isPlatformOp)
      end
      redis.call('EXPIRE', key, ttl)
      redis.call('SADD', sKey, userId)
      redis.call('EXPIRE', sKey, ttl)
      return exists
    `;
    try {
      await this.r.eval(lua, {
        keys: [hashKey(input.partnerId, input.userId), setKey(input.partnerId), lastStatusKey(input.partnerId, input.userId)],
        arguments: [
          input.userId, input.name, input.role, input.partnerId,
          input.isPlatformOperator ? '1' : '0', String(TTL_SECONDS), new Date().toISOString(),
        ],
      });
    } catch (err) {
      this.deps.logger.error({ err, userId: input.userId }, 'RedisLiveState.upsertIdentity failed');
      throw err;
    }
  }

  async readStatus(partnerId: string, userId: string): Promise<AgentStatus | null> {
    if (!this.r) return null;
    const v = await this.r.hGet(hashKey(partnerId, userId), 'status');
    if (v === 'online' || v === 'away') return v;
    return null;
  }

  async writeStatus(partnerId: string, userId: string, status: AgentStatus): Promise<boolean> {
    if (!this.r) return false;
    const exists = await this.r.hExists(hashKey(partnerId, userId), 'userId');
    if (!exists) return false;
    await this.r.hSet(hashKey(partnerId, userId), {
      status,
      statusChangedAt: new Date().toISOString(),
    });
    // Mirror to last_status so the next first-seen identify (after a full disconnect) restores this status.
    await this.r.set(lastStatusKey(partnerId, userId), status, { EX: TTL_SECONDS });
    return true;
  }

  async markOfflineAt(partnerId: string, userId: string, at: Date) {
    if (!this.r) return;
    await this.r.set(offlineAtKey(partnerId, userId), at.toISOString(), { EX: TTL_SECONDS });
  }

  async readOfflineAt(partnerId: string, userId: string): Promise<Date | null> {
    if (!this.r) return null;
    const v = await this.r.get(offlineAtKey(partnerId, userId));
    if (!v) return null;
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  async clearOfflineAt(partnerId: string, userId: string) {
    if (!this.r) return;
    await this.r.del(offlineAtKey(partnerId, userId));
  }

  async listOnline(partnerId: string): Promise<OnlineUser[]> {
    if (!this.r) return [];
    const memberIds = await this.r.sMembers(setKey(partnerId));
    if (memberIds.length === 0) return [];
    const pipeline = this.r.multi();
    for (const uid of memberIds) pipeline.hGetAll(hashKey(partnerId, uid));
    const results = await pipeline.exec();
    const out: OnlineUser[] = [];
    for (const result of results) {
      const data = result as unknown as Record<string, string>;
      if (data && data.userId) {
        const status: AgentStatus = data.status === 'away' ? 'away' : 'online';
        out.push({
          userId: data.userId,
          name: data.name,
          role: data.role,
          status,
          partnerId: data.partnerId,
          isPlatformOperator: data.isPlatformOperator === '1',
        });
      }
    }
    return out;
  }

  async flushAll() {
    if (!this.r) return { deleted: 0 };
    let deleted = 0;
    const patterns = [`${HASH_PREFIX}*`, `${SET_PREFIX}*`, `${LAST_STATUS_PREFIX}*`];
    for (const pattern of patterns) {
      let cursor: string | number = 0;
      do {
        const result = await this.r.scan(String(cursor), { MATCH: pattern, COUNT: 200 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await this.r.del(result.keys);
          deleted += result.keys.length;
        }
      } while (Number(cursor) !== 0);
    }
    return { deleted };
  }
}
