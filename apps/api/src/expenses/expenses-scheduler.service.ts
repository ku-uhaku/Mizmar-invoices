import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { ExpensesService } from './expenses.service';

const TICK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Generates due recurring bills hourly (and once shortly after boot, to catch up
 * after downtime). Shares the RECURRING_ENABLED switch with recurring invoices.
 */
@Injectable()
export class ExpensesSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExpensesSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private boot: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly expenses: ExpensesService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('RECURRING_ENABLED', { infer: true })) return;
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    this.timer.unref();
    this.boot = setTimeout(() => void this.tick(), 20_000);
    this.boot.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.boot) clearTimeout(this.boot);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const generated = await this.expenses.generateDue();
      if (generated) this.logger.log(`Recurring expenses: ${generated} bill(s) generated`);
    } catch (error) {
      this.logger.error(`Recurring expenses tick failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.running = false;
    }
  }
}
