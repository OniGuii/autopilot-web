import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../shared/redis/redis.service';
import { newCorrelationId } from '../whatsapp/correlation';
import {
  RECONCILE_SCAN_INTERVAL_MS_DEFAULT,
  RECONCILE_SCAN_LOCK_KEY,
} from './async.constants';
import { ReconcileProducer } from './producers/reconcile.producer';

/**
 * 7.2B — schedules reconcile-worker cycles when ASYNC_RECONCILE_ENABLED=true.
 */
@Injectable()
export class ReconcileScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconcileScheduler.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly redis: RedisService,
    private readonly producer: ReconcileProducer,
    config: ConfigService,
  ) {
    this.enabled =
      config.get<boolean>('async.reconcileEnabled', false) === true;
    this.intervalMs = config.get<number>(
      'async.reconcileScanIntervalMs',
      RECONCILE_SCAN_INTERVAL_MS_DEFAULT,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'reconcile scheduler disabled (ASYNC_RECONCILE_ENABLED=false)',
      );
      return;
    }
    this.logger.log(
      `reconcile scheduler enabled intervalMs=${this.intervalMs}`,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    setTimeout(() => void this.tick(), 3_000);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick(): Promise<{ enqueued: boolean }> {
    if (!this.enabled || this.ticking) {
      return { enqueued: false };
    }
    this.ticking = true;
    const lockTtl = Math.max(this.intervalMs - 1_000, 10_000);
    let token: string | null = null;
    try {
      token = await this.redis.tryAcquireLock(RECONCILE_SCAN_LOCK_KEY, lockTtl);
      if (!token) return { enqueued: false };

      const result = await this.producer.enqueueCycle(newCorrelationId());
      if (!result.deduped) {
        this.logger.log(`reconcile cycle enqueued jobId=${result.jobId}`);
      }
      return { enqueued: !result.deduped };
    } catch (err) {
      this.logger.warn(
        `reconcile schedule tick failed: ${err instanceof Error ? err.message : err}`,
      );
      return { enqueued: false };
    } finally {
      if (token) {
        await this.redis.releaseLock(RECONCILE_SCAN_LOCK_KEY, token);
      }
      this.ticking = false;
    }
  }
}
