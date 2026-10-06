import { Controller } from '@nestjs/common';
import { TsRestHandler, tsRestHandler } from '@ts-rest/nest';
import { apiContract } from '@mizmar/contracts';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { Env } from '../config/env';

const VERSION = process.env.npm_package_version ?? '0.1.0';

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @TsRestHandler(apiContract.health.health)
  health() {
    return tsRestHandler(apiContract.health.health, async () => {
      const [database, storage, redis] = await Promise.all([
        this.prisma.isHealthy(),
        this.storage.isHealthy(),
        this.checkRedis(),
      ]);

      return {
        status: 200 as const,
        body: { status: 'ok' as const, version: VERSION, database, redis, storage },
      };
    });
  }

  private async checkRedis(): Promise<boolean> {
    const client = new Redis(this.config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1500,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      return pong === 'PONG';
    } catch {
      return false;
    } finally {
      client.disconnect();
    }
  }
}
