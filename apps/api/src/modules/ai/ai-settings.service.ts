import { Injectable } from '@nestjs/common';
import { AiAgentMode } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_SETTINGS_UPDATE } from './ai.constants';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';

type Actor = { cid: string; sub: string };
type ReqMeta = { ip?: string; userAgent?: string };

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getOrCreate(actor: Actor) {
    const existing = await this.prisma.companyAiSettings.findFirst({
      where: { companyId: actor.cid, deletedAt: null },
    });
    if (existing) return this.serialize(existing);

    const created = await this.prisma.companyAiSettings.create({
      data: {
        companyId: actor.cid,
        mode: AiAgentMode.ASSIST,
        maxAutoRepliesPerLeadDay: 3,
      },
    });
    return this.serialize(created);
  }

  async update(actor: Actor, dto: UpdateAiSettingsDto, meta?: ReqMeta) {
    const before = await this.getOrCreate(actor);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.companyAiSettings.update({
        where: { companyId: actor.cid },
        data: {
          ...(dto.mode !== undefined ? { mode: dto.mode } : {}),
          ...(dto.maxAutoRepliesPerLeadDay !== undefined
            ? { maxAutoRepliesPerLeadDay: dto.maxAutoRepliesPerLeadDay }
            : {}),
        },
      });
      await this.audit.write(tx, {
        companyId: actor.cid,
        actorUserId: actor.sub,
        action: AI_SETTINGS_UPDATE,
        targetType: 'AI_SETTINGS',
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

  private serialize(row: {
    id: string;
    companyId: string;
    mode: AiAgentMode;
    maxAutoRepliesPerLeadDay: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      companyId: row.companyId,
      mode: row.mode,
      /** 11C — AUTO opt-in drives supervised auto-send. */
      autoEnabled: row.mode === AiAgentMode.AUTO,
      maxAutoRepliesPerLeadDay: row.maxAutoRepliesPerLeadDay,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
