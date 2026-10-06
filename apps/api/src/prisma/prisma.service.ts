import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/** The transaction-scoped client handed to services inside `$transaction`. */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Serialise work that must not interleave, keyed by a stable string.
   *
   * Used for gap-free document numbering: two users validating an invoice at
   * the same moment must not both read counter 7. A Postgres advisory lock
   * held for the life of the transaction is the cheapest correct answer —
   * cheaper than SERIALIZABLE retries, and it blocks only the one sequence.
   */
  async withAdvisoryLock<T>(tx: PrismaTx, key: string, fn: () => Promise<T>): Promise<T> {
    const [hi, lo] = hashKeyToInt32Pair(key);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${hi}::int, ${lo}::int)`;
    return fn();
  }
}

/**
 * Map an arbitrary key onto the two int32 arguments of pg_advisory_xact_lock.
 * FNV-1a: tiny, dependency-free and well spread for short keys.
 */
function hashKeyToInt32Pair(key: string): [number, number] {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < key.length; i += 1) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b);
  }
  return [h1 | 0, h2 | 0];
}

export { Prisma };
