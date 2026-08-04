import { ConflictException, Injectable } from '@nestjs/common';
import {
  CompanyCurrency,
  MembershipRole,
  Prisma,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { runWithRlsBypassAsync } from '../../prisma/rls-context';
import { AuditService } from '../audit/audit.service';
import {
  MEMBERSHIP_STATUS_ACTIVE,
  MEMBERSHIP_STATUS_INVITED,
  MEMBERSHIP_STATUS_REVOKED,
} from '../auth/auth.constants';
import type { AuthenticatedUser } from '../auth/types/jwt-payload';
import { CreateSetupCompanyDto } from './dto/create-setup-company.dto';

type RequestMeta = {
  ip?: string;
  userAgent?: string;
};

@Injectable()
export class SetupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getStatus(user: AuthenticatedUser) {
    const memberships = await this.prisma.membership.findMany({
      where: {
        userId: user.sub,
        deletedAt: null,
        status: { not: MEMBERSHIP_STATUS_REVOKED },
      },
      select: { id: true, companyId: true, status: true, role: true },
    });

    const hasCompany = memberships.some(
      (m) =>
        m.status === MEMBERSHIP_STATUS_ACTIVE ||
        m.status === MEMBERSHIP_STATUS_INVITED,
    );

    if (!user.cid) {
      return {
        steps: [
          {
            key: 'company',
            done: hasCompany,
          },
          { key: 'whatsapp', done: false, detail: 'NO_COMPANY_CONTEXT' },
          { key: 'firstLead', done: false, detail: 'NO_COMPANY_CONTEXT' },
          { key: 'firstMessage', done: false, detail: 'NO_COMPANY_CONTEXT' },
        ],
        complete: false,
      };
    }

    const companyId = user.cid;
    const [whatsapp, leadCount, messageCount] = await Promise.all([
      this.prisma.whatsAppInstance.findFirst({
        where: { companyId, deletedAt: null },
        select: { status: true },
      }),
      this.prisma.lead.count({
        where: { companyId, deletedAt: null },
      }),
      this.prisma.message.count({
        where: { companyId, deletedAt: null },
      }),
    ]);

    const whatsappDone =
      whatsapp?.status === WhatsAppConnectionStatus.CONNECTED;
    const firstLeadDone = leadCount >= 1;
    const firstMessageDone = messageCount >= 1;

    const steps = [
      { key: 'company', done: true },
      {
        key: 'whatsapp',
        done: whatsappDone,
        detail: whatsapp ? whatsapp.status : 'NO_INSTANCE',
      },
      { key: 'firstLead', done: firstLeadDone },
      { key: 'firstMessage', done: firstMessageDone },
    ];

    return {
      steps,
      complete: steps.every((s) => s.done),
    };
  }

  /**
   * D4 — pilot allows only 1 company per user.
   */
  async createCompany(
    user: AuthenticatedUser,
    dto: CreateSetupCompanyDto,
    meta?: RequestMeta,
  ) {
    const existingCount = await this.prisma.membership.count({
      where: {
        userId: user.sub,
        deletedAt: null,
        status: { not: MEMBERSHIP_STATUS_REVOKED },
      },
    });
    if (existingCount > 0) {
      throw new ConflictException({
        code: 'SETUP_COMPANY_LIMIT',
        message: 'Pilot allows only one company per user',
      });
    }

    const slug =
      dto.slug?.trim() ||
      dto.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 100) ||
      `company-${user.sub.slice(0, 8)}`;

    try {
      // Bootstrap before JWT.cid exists — use RLS bypass (same pattern as seeds/scanners).
      return await runWithRlsBypassAsync(() =>
        this.prisma.$transaction(async (tx) => {
          const company = await tx.company.create({
            data: {
              name: dto.name.trim(),
              slug,
              timezone: dto.timezone ?? 'America/Sao_Paulo',
              locale: dto.locale ?? 'pt-BR',
              currency: CompanyCurrency.BRL,
              status: 'ACTIVE',
              plan: 'starter',
            },
          });

          const membership = await tx.membership.create({
            data: {
              companyId: company.id,
              userId: user.sub,
              role: MembershipRole.OWNER,
              status: MEMBERSHIP_STATUS_ACTIVE,
              invitedBy: user.sub,
              joinedAt: new Date(),
            },
          });

          await this.audit.write(tx, {
            companyId: company.id,
            actorUserId: user.sub,
            action: 'COMPANY_CREATE',
            targetType: 'COMPANY',
            targetId: company.id,
            before: null,
            after: {
              name: company.name,
              slug: company.slug,
              locale: company.locale,
              currency: company.currency,
            },
            ip: meta?.ip,
            userAgent: meta?.userAgent,
          });

          await this.audit.write(tx, {
            companyId: company.id,
            actorUserId: user.sub,
            action: 'MEMBERSHIP_CREATE',
            targetType: 'MEMBERSHIP',
            targetId: membership.id,
            before: null,
            after: {
              role: membership.role,
              status: membership.status,
              setupWizard: true,
            },
            ip: meta?.ip,
            userAgent: meta?.userAgent,
          });

          return {
            company: {
              id: company.id,
              name: company.name,
              slug: company.slug,
              timezone: company.timezone,
              locale: company.locale,
              currency: company.currency,
            },
            membership: {
              id: membership.id,
              role: membership.role,
              status: membership.status,
            },
            next: {
              selectCompany: {
                method: 'POST',
                path: '/api/auth/select-company',
                body: { companySlug: company.slug },
              },
            },
          };
        }),
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'COMPANY_SLUG_CONFLICT',
          message: 'Company slug already in use',
        });
      }
      throw error;
    }
  }
}
