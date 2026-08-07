import { BadRequestException, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AI_RECOVERY_DEFAULT_CADENCE_HOURS,
  AI_RECOVERY_DEFAULT_COOLDOWN_HOURS,
  AI_RECOVERY_DEFAULT_MAX_ATTEMPTS,
  AI_RECOVERY_PRESETS,
  AI_SETTINGS_UPDATE,
} from './ai.constants';
import { UpdateRecoverySettingsDto } from './dto/update-recovery-settings.dto';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

@Injectable()
export class AiRecoverySettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreate(actor: Actor) {
    const existing = await this.prisma.companyRecoverySettings.findFirst({
      where: { companyId: actor.cid, deletedAt: null },
    });
    if (existing) return this.serialize(existing);

    const created = await this.prisma.companyRecoverySettings.create({
      data: {
        companyId: actor.cid,
        enabled: false,
        maxAttempts: AI_RECOVERY_DEFAULT_MAX_ATTEMPTS,
        cooldownHours: AI_RECOVERY_DEFAULT_COOLDOWN_HOURS,
        stopOnReply: true,
        stopOnHumanTakeover: true,
        cadenceHours: [...AI_RECOVERY_DEFAULT_CADENCE_HOURS],
      },
    });
    return this.serialize(created);
  }

  async update(actor: Actor, dto: UpdateRecoverySettingsDto, meta?: ReqMeta) {
    const before = await this.getOrCreate(actor);

    if (dto.cadenceHours) {
      const sorted = [...dto.cadenceHours].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        if (sorted[i] <= sorted[i - 1]) {
          throw new BadRequestException(
            'cadenceHours must be strictly increasing (R1 < R2 < R3)',
          );
        }
      }
    }

    if (
      dto.allowedHoursStart != null &&
      dto.allowedHoursEnd != null &&
      dto.allowedHoursStart >= dto.allowedHoursEnd
    ) {
      throw new BadRequestException(
        'allowedHoursStart must be < allowedHoursEnd',
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.companyRecoverySettings.update({
        where: { companyId: actor.cid },
        data: {
          ...(dto.enabled !== undefined ? { enabled: dto.enabled } : {}),
          ...(dto.maxAttempts !== undefined
            ? { maxAttempts: dto.maxAttempts }
            : {}),
          ...(dto.cooldownHours !== undefined
            ? { cooldownHours: dto.cooldownHours }
            : {}),
          ...(dto.stopOnReply !== undefined
            ? { stopOnReply: dto.stopOnReply }
            : {}),
          ...(dto.stopOnHumanTakeover !== undefined
            ? { stopOnHumanTakeover: dto.stopOnHumanTakeover }
            : {}),
          ...(dto.cadenceHours !== undefined
            ? {
                cadenceHours: [...dto.cadenceHours].sort((a, b) => a - b),
              }
            : {}),
          ...(dto.allowedHoursStart !== undefined
            ? { allowedHoursStart: dto.allowedHoursStart }
            : {}),
          ...(dto.allowedHoursEnd !== undefined
            ? { allowedHoursEnd: dto.allowedHoursEnd }
            : {}),
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: AI_SETTINGS_UPDATE,
        targetType: 'AI_RECOVERY_SETTINGS',
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
    maxAttempts: number;
    cooldownHours: number;
    stopOnReply: boolean;
    stopOnHumanTakeover: boolean;
    cadenceHours: number[];
    allowedHoursStart: number | null;
    allowedHoursEnd: number | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      enabled: row.enabled,
      maxAttempts: row.maxAttempts,
      cooldownHours: row.cooldownHours,
      stopOnReply: row.stopOnReply,
      stopOnHumanTakeover: row.stopOnHumanTakeover,
      cadenceHours: row.cadenceHours,
      allowedHoursStart: row.allowedHoursStart,
      allowedHoursEnd: row.allowedHoursEnd,
      presets: Object.values(AI_RECOVERY_PRESETS),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
