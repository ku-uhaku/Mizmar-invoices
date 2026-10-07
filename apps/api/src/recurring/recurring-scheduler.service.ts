import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { RecurringRunnerService } from './recurring-runner.service';

export const TICK_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Ticks the runner every ten minutes (and once shortly after boot, to catch up
 * after downtime).
 *
 * A plain timer rather than @nestjs/schedule: it is the only periodic task in
 * the API and the dependency was not installed. Running one instance or many
 * is safe because the runner locks each schedule row. Set RECURRING_ENABLED=false
 * to turn it off (tests, local dev).
 */
@Injectable()
export class RecurringSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private boot: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly runner: RecurringRunnerService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('RECURRING_ENABLED', { infer: true })) {
      this.logger.log('Recurring invoices scheduler disabled (RECURRING_ENABLED=false)');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref();
    this.boot = setTimeout(() => void this.tick(), 15_000);
    this.boot.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.boot) clearTimeout(this.boot);
  }

  async tick(): Promise<void> {
    // Never overlap with a previous tick that is still catching up.
    if (this.running) return;
    this.running = true;
    try {
      const { generated, failed } = await this.runner.tick();
      if (generated || failed) {
        this.logger.log(`Recurring tick: ${generated} generated, ${failed} failed`);
      }
    } catch (error) {
      this.logger.error(`Recurring tick failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }
}
