import { Injectable } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OUTBOUND_OPT_OUT,
  OUTBOUND_PROACTIVE_BLOCKED,
  OUTBOUND_PROACTIVE_SOURCES,
  OUTBOUND_SUPPRESS_ADDED,
} from './outbound.constants';
import { OutboundProtectionSettingsService } from './outbound-protection-settings.service';

type Actor = { cid: string; sub: string };

@Injectable()
export class OutboundProtectionDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: OutboundProtectionSettingsService,
  ) {}

  async getOverview(actor: Actor) {
    const policy = await this.settings.getOrCreate(actor);
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);
    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const sourceOr = OUTBOUND_PROACTIVE_SOURCES.map((source) => ({
      metadata: { path: ['source'], equals: source },
    }));

    const [
      proactiveToday,
      proactiveHour,
      proactiveWeek,
      suppressActive,
      suppressWeek,
      optOutsWeek,
      blocksToday,
    ] = await Promise.all([
      this.prisma.message.count({
        where: {
          companyId: actor.cid,
          deletedAt: null,
          direction: MessageDirection.OUTBOUND,
          createdAt: { gte: dayStart },
          OR: sourceOr,
        },
      }),
      this.prisma.message.count({
        where: {
          companyId: actor.cid,
          deletedAt: null,
          direction: MessageDirection.OUTBOUND,
          createdAt: { gte: hourStart },
          OR: sourceOr,
        },
      }),
      this.prisma.message.count({
        where: {
          companyId: actor.cid,
          deletedAt: null,
          direction: MessageDirection.OUTBOUND,
          createdAt: { gte: weekStart },
          OR: sourceOr,
        },
      }),
      this.prisma.outboundSuppressEntry.count({
        where: { companyId: actor.cid, active: true, deletedAt: null },
      }),
      this.prisma.outboundSuppressEntry.count({
        where: {
          companyId: actor.cid,
          deletedAt: null,
          createdAt: { gte: weekStart },
        },
      }),
      this.prisma.auditLog.count({
        where: {
          companyId: actor.cid,
          deletedAt: null,
          action: OUTBOUND_OPT_OUT,
          createdAt: { gte: weekStart },
        },
      }),
      this.prisma.auditLog.count({
        where: {
          companyId: actor.cid,
          deletedAt: null,
          action: OUTBOUND_PROACTIVE_BLOCKED,
          createdAt: { gte: dayStart },
        },
      }),
    ]);

    const remainingDaily = Math.max(
      0,
      policy.dailyProactiveCap - proactiveToday,
    );
    const remainingHourly = Math.max(
      0,
      policy.hourlyProactiveCap - proactiveHour,
    );

    return {
      companyId: actor.cid,
      generatedAt: new Date().toISOString(),
      policy: {
        enabled: policy.enabled,
        dailyProactiveCap: policy.dailyProactiveCap,
        hourlyProactiveCap: policy.hourlyProactiveCap,
        leadCooldownMinutes: policy.leadCooldownMinutes,
        minSpacingSeconds: policy.minSpacingSeconds,
        allowedHoursStart: policy.allowedHoursStart,
        allowedHoursEnd: policy.allowedHoursEnd,
        autoSuppressOnLost: policy.autoSuppressOnLost,
        suppressOnKeywords: policy.suppressOnKeywords,
      },
      metrics: {
        proactiveSentToday: proactiveToday,
        proactiveSentHour: proactiveHour,
        proactiveSentWeek: proactiveWeek,
        remainingDaily,
        remainingHourly,
        suppressActive,
        suppressCreatedWeek: suppressWeek,
        optOutsWeek,
        blocksToday,
        suppressAddedAuditWeek: await this.prisma.auditLog.count({
          where: {
            companyId: actor.cid,
            deletedAt: null,
            action: OUTBOUND_SUPPRESS_ADDED,
            createdAt: { gte: weekStart },
          },
        }),
      },
    };
  }
}
