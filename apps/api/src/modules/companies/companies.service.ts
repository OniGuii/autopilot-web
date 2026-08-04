import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Company, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

type CompanyActor = AuthenticatedUser & { cid: string; sub: string };

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getSettings(actor: CompanyActor) {
    const company = await this.prisma.company.findFirst({
      where: { id: actor.cid, deletedAt: null },
    });
    if (!company) {
      throw new NotFoundException('Company not found');
    }
    return this.toSettings(company);
  }

  async updateSettings(
    actor: CompanyActor,
    dto: UpdateCompanySettingsDto,
    meta?: RequestMeta,
  ) {
    const existing = await this.prisma.company.findFirst({
      where: { id: actor.cid, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException('Company not found');
    }

    const data: Prisma.CompanyUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.timezone !== undefined) data.timezone = dto.timezone;
    if (dto.locale !== undefined) data.locale = dto.locale;
    if (dto.businessHours !== undefined) {
      data.businessHours =
        dto.businessHours === null
          ? Prisma.JsonNull
          : (dto.businessHours as Prisma.InputJsonValue);
    }
    if (dto.logoUrl !== undefined) data.logoUrl = dto.logoUrl;
    if (dto.currency !== undefined) data.currency = dto.currency;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const company = await tx.company.update({
          where: { id: actor.cid },
          data,
        });
        await this.audit.write(tx, {
          companyId: actor.cid,
          actorUserId: actor.sub,
          action: 'COMPANY_SETTINGS_UPDATE',
          targetType: 'COMPANY',
          targetId: company.id,
          before: this.snapshot(existing),
          after: this.snapshot(company),
          ip: meta?.ip,
          userAgent: meta?.userAgent,
        });
        return company;
      });
      return this.toSettings(updated);
    } catch (error) {
      this.rethrowSlugConflict(error);
      throw error;
    }
  }

  private toSettings(company: Company) {
    return {
      id: company.id,
      name: company.name,
      slug: company.slug,
      timezone: company.timezone,
      locale: company.locale,
      businessHours: company.businessHours,
      logoUrl: company.logoUrl,
      currency: company.currency,
      updatedAt: company.updatedAt,
    };
  }

  private snapshot(company: Company) {
    return {
      name: company.name,
      slug: company.slug,
      timezone: company.timezone,
      locale: company.locale,
      businessHours: company.businessHours,
      logoUrl: company.logoUrl,
      currency: company.currency,
    };
  }

  private rethrowSlugConflict(error: unknown): void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException({
        code: 'COMPANY_SLUG_CONFLICT',
        message: 'Company slug already in use',
      });
    }
  }
}
