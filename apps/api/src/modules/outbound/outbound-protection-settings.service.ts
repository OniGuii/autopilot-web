import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  OUTBOUND_DEFAULT_DAILY_CAP,
  OUTBOUND_DEFAULT_HOURLY_CAP,
  OUTBOUND_DEFAULT_LEAD_COOLDOWN_MINUTES,
  OUTBOUND_DEFAULT_MIN_SPACING_SECONDS,
  OUTBOUND_DEFAULT_SUPPRESS_KEYWORDS,
  OUTBOUND_PROTECTION_UPDATED,
} from './outbound.constants';
import { UpdateOutboundProtectionSettingsDto } from './dto/update-outbound-protection-settings.dto';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

@Injectable()
export class OutboundProtectionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreate(actor: Actor) {
    const existing =
      await this.prisma.companyOutboundProtectionSettings.findFirst({
        where: { companyId: actor.cid, deletedAt: null },
      });
    if (existing) return this.serialize(existing);

    const created = await this.prisma.companyOutboundProtectionSettings.create({
      data: {
        companyId: actor.cid,
        enabled: false,
        dailyProactiveCap: OUTBOUND_DEFAULT_DAILY_CAP,
        hourlyProactiveCap: OUTBOUND_DEFAULT_HOURLY_CAP,
        leadCooldownMinutes: OUTBOUND_DEFAULT_LEAD_COOLDOWN_MINUTES,
        minSpacingSeconds: OUTBOUND_DEFAULT_MIN_SPACING_SECONDS,
        suppressOnKeywords: [...OUTBOUND_DEFAULT_SUPPRESS_KEYWORDS],
        autoSuppressOnLost: true,
      },
    });
    return this.serialize(created);
  }

  async update(
    actor: Actor,
    dto: UpdateOutboundProtectionSettingsDto,
    meta?: ReqMeta,
  ) {
    const before = await this.getOrCreate(actor);

    if (
      dto.allowedHoursStart != null &&
      dto.allowedHoursEnd != null &&
      dto.allowedHoursStart >= dto.allowedHoursEnd
    ) {
      throw new BadRequestException(
        'allowedHoursStart must be < allowedHoursEnd',
      );
    }

    if (
      dto.hourlyProactiveCap != null &&
      dto.dailyProactiveCap != null &&
      dto.hourlyProactiveCap > dto.dailyProactiveCap
    ) {
      throw new BadRequestException(
        'hourlyProactiveCap must be <= dailyProactiveCap',
      );
    }

    const nextDaily = dto.dailyProactiveCap ?? before.dailyProactiveCap;
    const nextHourly = dto.hourlyProactiveCap ?? before.hourlyProactiveCap;
    if (nextHourly > nextDaily) {
      throw new BadRequestException(
        'hourlyProactiveCap must be <= dailyProactiveCap',
      );
    }

    const keywords =
      dto.suppressOnKeywords !== undefined
        ? [
            ...new Set(
              dto.suppressOnKeywords
                .map((k) => k.trim().toLowerCase())
                .filter(Boolean),
            ),
          ]
        : undefined;

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.companyOutboundProtectionSettings.update({
        where: { companyId: actor.cid },
        data: {
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.dailyProactiveCap !== undefined
            ? { dailyProactiveCap: dto.dailyProactiveCap }
            : {}),
          ...(dto.hourlyProactiveCap !== undefined
            ? { hourlyProactiveCap: dto.hourlyProactiveCap }
            : {}),
          ...(dto.leadCooldownMinutes !== undefined
            ? { leadCooldownMinutes: dto.leadCooldownMinutes }
            : {}),
          ...(dto.minSpacingSeconds !== undefined
            ? { minSpacingSeconds: dto.minSpacingSeconds }
            : {}),
          ...(dto.allowedHoursStart !== undefined
            ? { allowedHoursStart: dto.allowedHoursStart }
            : {}),
          ...(dto.allowedHoursEnd !== undefined
            ? { allowedHoursEnd: dto.allowedHoursEnd }
            : {}),
          ...(keywords !== undefined ? { suppressOnKeywords: keywords } : {}),
          ...(dto.autoSuppressOnLost !== undefined
            ? { autoSuppressOnLost: dto.autoSuppressOnLost }
            : {}),
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: OUTBOUND_PROTECTION_UPDATED,
        targetType: 'OUTBOUND_PROTECTION_SETTINGS',
        targetId: updated.id,
        before,
        after: this.serialize(updated),
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      });
      return updated;
    });
    return this.serialize(row);
  }

  serialize(row: {
    id: string;
    companyId: string;
    enabled: boolean;
    dailyProactiveCap: number;
    hourlyProactiveCap: number;
    leadCooldownMinutes: number;
    minSpacingSeconds: number;
    allowedHoursStart: number | null;
    allowedHoursEnd: number | null;
    suppressOnKeywords: string[];
    autoSuppressOnLost: boolean;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      enabled: row.enabled,
      dailyProactiveCap: row.dailyProactiveCap,
      hourlyProactiveCap: row.hourlyProactiveCap,
      leadCooldownMinutes: row.leadCooldownMinutes,
      minSpacingSeconds: row.minSpacingSeconds,
      allowedHoursStart: row.allowedHoursStart,
      allowedHoursEnd: row.allowedHoursEnd,
      suppressOnKeywords: row.suppressOnKeywords,
      autoSuppressOnLost: row.autoSuppressOnLost,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
