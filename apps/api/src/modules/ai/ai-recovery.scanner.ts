import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithRlsBypassAsync } from '../../prisma/rls-context';
import { RedisService } from '../../shared/redis/redis.service';
import {
  AI_RECOVERY_SCAN_BATCH,
  AI_RECOVERY_SCAN_INTERVAL_MS,
  AI_RECOVERY_SCAN_LOCK_KEY,
} from './ai.constants';
import { AiRecoveryService } from './ai-recovery.service';

/**
 * 11D — polls companies with recovery.enabled and schedules AI_RECOVERY FollowUps.
 * Reuses Redis lock pattern from FollowUpDueScanner.
 */
@Injectable()
export class AiRecoveryScanner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiRecoveryScanner.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly recovery: AiRecoveryService,
    config: ConfigService,
  ) {
    // Share followup async flag — recovery schedules into the same scheduler.
    this.enabled = config.get<boolean>('async.followupEnabled', false) === true;
    this.intervalMs = config.get<number>(
      'async.recoveryScanIntervalMs',
      AI_RECOVERY_SCAN_INTERVAL_MS,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log(
        'recovery scanner disabled (ASYNC_FOLLOWUP_ENABLED=false)',
      );
      return;
    }
    this.logger.log(`recovery scanner enabled intervalMs=${this.intervalMs}`);
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
    setTimeout(() => void this.tick(), 2_500);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<{ companies: number; scheduled: number }> {
    if (!this.enabled || this.ticking) {
      return { companies: 0, scheduled: 0 };
    }
    this.ticking = true;
    const lockTtl = Math.max(this.intervalMs - 1_000, 5_000);
    let token: string | null = null;
    try {
      token = await this.redis.tryAcquireLock(
        AI_RECOVERY_SCAN_LOCK_KEY,
        lockTtl,
      );
      if (!token) return { companies: 0, scheduled: 0 };

      const companies = await runWithRlsBypassAsync(() =>
        this.prisma.companyRecoverySettings.findMany({
          where: { deletedAt: null, enabled: true },
          select: { companyId: true },
          take: AI_RECOVERY_SCAN_BATCH,
        }),
      );

      let scheduled = 0;
      for (const row of companies) {
        scheduled += await runWithRlsBypassAsync(() =>
          this.recovery.scheduleEligibleForCompany(row.companyId),
        );
      }

      if (scheduled > 0) {
        this.logger.log(
          `recovery scan companies=${companies.length} scheduled=${scheduled}`,
        );
      }
      return { companies: companies.length, scheduled };
    } catch (err) {
      this.logger.warn(
        `recovery scan failed: ${err instanceof Error ? err.message : err}`,
      );
      return { companies: 0, scheduled: 0 };
    } finally {
      if (token) await this.redis.releaseLock(AI_RECOVERY_SCAN_LOCK_KEY, token);
      this.ticking = false;
    }
  }
}
