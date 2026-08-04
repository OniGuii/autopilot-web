import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FollowUpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithRlsBypassAsync } from '../../prisma/rls-context';
import { RedisService } from '../../shared/redis/redis.service';
import { newCorrelationId } from '../whatsapp/correlation';
import {
  FOLLOWUP_SCAN_LOCK_KEY,
  FOLLOWUP_SCHEDULER_SCAN_BATCH_DEFAULT,
  FOLLOWUP_SCHEDULER_SCAN_INTERVAL_MS_DEFAULT,
} from './async.constants';
import { FollowUpSchedulerProducer } from './producers/followup-scheduler.producer';

/**
 * 7.2A — polls due SCHEDULED follow-ups and enqueues execute jobs.
 * Gated by ASYNC_FOLLOWUP_ENABLED (default false).
 */
@Injectable()
export class FollowUpDueScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FollowUpDueScanner.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly producer: FollowUpSchedulerProducer,
    config: ConfigService,
  ) {
    this.enabled = config.get<boolean>('async.followupEnabled', false) === true;
    this.intervalMs = config.get<number>(
      'async.followupScanIntervalMs',
      FOLLOWUP_SCHEDULER_SCAN_INTERVAL_MS_DEFAULT,
    );
    this.batchSize = config.get<number>(
      'async.followupScanBatch',
      FOLLOWUP_SCHEDULER_SCAN_BATCH_DEFAULT,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'followup due scanner disabled (ASYNC_FOLLOWUP_ENABLED=false)',
      );
      return;
    }
    this.logger.log(
      `followup due scanner enabled intervalMs=${this.intervalMs} batch=${this.batchSize}`,
    );
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    // Kick once shortly after boot.
    setTimeout(() => void this.tick(), 1_500);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Exposed for tests. */
  async tick(): Promise<{ enqueued: number; scanned: number }> {
    if (!this.enabled || this.ticking) {
      return { enqueued: 0, scanned: 0 };
    }
    this.ticking = true;

    const lockTtl = Math.max(this.intervalMs - 1_000, 5_000);
    let token: string | null = null;
    try {
      token = await this.redis.tryAcquireLock(FOLLOWUP_SCAN_LOCK_KEY, lockTtl);
      if (!token) {
        return { enqueued: 0, scanned: 0 };
      }

      const due = await runWithRlsBypassAsync(() =>
        this.prisma.followUp.findMany({
          where: {
            deletedAt: null,
            status: FollowUpStatus.SCHEDULED,
            scheduledAt: { lte: new Date(), not: null },
          },
          select: { id: true, companyId: true },
          orderBy: { scheduledAt: 'asc' },
          take: this.batchSize,
        }),
      );

      let enqueued = 0;
      for (const row of due) {
        try {
          const result = await this.producer.enqueue({
            v: 1,
            companyId: row.companyId,
            followUpId: row.id,
            correlationId: newCorrelationId(),
            trigger: 'schedule',
          });
          if (!result.deduped) enqueued += 1;
        } catch (err) {
          this.logger.warn(
            `enqueue due followup failed id=${row.id}: ${err instanceof Error ? err.message : err}`,
          );
        }
      }

      if (due.length > 0) {
        this.logger.log(
          `followup scan scanned=${due.length} enqueued=${enqueued}`,
        );
      }
      return { enqueued, scanned: due.length };
    } catch (err) {
      this.logger.warn(
        `followup scan tick failed: ${err instanceof Error ? err.message : err}`,
      );
      return { enqueued: 0, scanned: 0 };
    } finally {
      if (token) {
        await this.redis.releaseLock(FOLLOWUP_SCAN_LOCK_KEY, token);
      }
      this.ticking = false;
    }
  }
}
