import { INestApplication } from '@nestjs/common';
import {
  MembershipRole,
  UserStatus,
  WhatsAppConnectionStatus,
} from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { runWithTenant } from '../src/core/tenancy/tenant-als';
import { PrismaService } from '../src/prisma/prisma.service';
import { runWithRlsBypassAsync } from '../src/prisma/rls-context';
import {
  upsertMembership,
  upsertUser,
} from '../prisma/seeds/shared/factories';
import { authAs } from './helpers/auth';
import {
  createE2eApp,
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from './helpers/e2e-app';

const WEBHOOK_SECRET = 'e2e-pilot-stabilization-secret';

describe('Pilot Stabilization — critical path (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ownerToken: string;
  let companyId: string;
  let instanceKey: string;

  beforeAll(async () => {
    app = await createE2eApp();
    prisma = app.get(PrismaService);
    ownerToken = await authAs(app);

    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });
    companyId = company!.id;
    instanceKey = randomUUID();

    await runWithTenant(companyId, async () => {
      const existingWa = await prisma.whatsAppInstance.findFirst({
        where: { companyId, deletedAt: null },
      });
      const hash = await argon2.hash(WEBHOOK_SECRET);
      if (existingWa) {
        await prisma.whatsAppInstance.update({
          where: { id: existingWa.id },
          data: {
            instanceKey,
            status: WhatsAppConnectionStatus.CONNECTED,
            webhookSecretHash: hash,
            phoneNumber: '5511988887777',
            connectedAt: new Date(),
            evolutionInstanceName: `ap-e2e-stab-${instanceKey.slice(0, 8)}`,
            lastError: null,
          },
        });
      } else {
        await prisma.whatsAppInstance.create({
          data: {
            companyId,
            instanceKey,
            evolutionInstanceName: `ap-e2e-stab-${instanceKey.slice(0, 8)}`,
            status: WhatsAppConnectionStatus.CONNECTED,
            phoneNumber: '5511988887777',
            webhookSecretHash: hash,
            connectedAt: new Date(),
          },
        });
      }
    });

    await runWithRlsBypassAsync(async () => {
      const owner = await prisma.user.findUnique({
        where: { email: E2E_OWNER_EMAIL },
      });
      const agentEmail = 'stab-agent@test.autopilot.dev';
      const agent = await upsertUser(prisma as never, {
        email: agentEmail,
        name: 'Stab Agent',
      });
      await upsertMembership(prisma as never, {
        companyId,
        userId: agent.id,
        role: MembershipRole.AGENT,
        invitedBy: owner!.id,
      });
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('onboarding status + login + select-company', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: E2E_OWNER_EMAIL, password: E2E_PASSWORD })
      .expect(200);
    expect(loginRes.body.accessToken).toBeTruthy();

    const selectRes = await request(app.getHttpServer())
      .post('/api/auth/select-company')
      .set('Authorization', `Bearer ${loginRes.body.accessToken}`)
      .send({ companySlug: E2E_COMPANY_SLUG })
      .expect(200);
    expect(selectRes.body.company.slug).toBe(E2E_COMPANY_SLUG);

    const setup = await request(app.getHttpServer())
      .get('/api/setup/status')
      .set('Authorization', `Bearer ${selectRes.body.accessToken}`)
      .expect(200);
    expect(setup.body.steps.find((s: { key: string }) => s.key === 'company').done).toBe(
      true,
    );
  });

  it('create lead → inbound WhatsApp → outbound → AI suggest → follow-up', async () => {
    const phone = `+5511988${String(Date.now()).slice(-7)}`;

    const leadRes = await request(app.getHttpServer())
      .post('/api/leads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Stab Lead', phone, source: 'WHATSAPP' })
      .expect(201);
    const leadId = leadRes.body.id as string;

    const inboundPhone = phone.replace('+', '');
    const inbound = await request(app.getHttpServer())
      .post(`/api/whatsapp/webhook/${instanceKey}`)
      .set('X-Webhook-Secret', WEBHOOK_SECRET)
      .send({
        event: 'messages.upsert',
        data: {
          key: {
            remoteJid: `${inboundPhone}@s.whatsapp.net`,
            fromMe: false,
            id: `WA_STAB_${Date.now()}`,
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { conversation: 'Oi, quero saber mais do piloto' },
        },
      })
      .expect(200);

    expect(inbound.body.ok).toBe(true);
    const conversationId =
      (inbound.body.conversationId as string | undefined) ??
      (
        await prisma.conversation.findFirst({
          where: { leadId, deletedAt: null },
          orderBy: { createdAt: 'desc' },
        })
      )?.id;
    expect(conversationId).toBeTruthy();

    const outbound = await request(app.getHttpServer())
      .post('/api/whatsapp/send')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        leadId,
        conversationId,
        body: 'Olá! Sou da Autopilot Demo — como posso ajudar?',
      })
      .expect((res) => {
        // Sync stub send typically 200/201; accept 2xx
        if (res.status < 200 || res.status >= 300) {
          throw new Error(`outbound unexpected status ${res.status}`);
        }
      });
    expect(outbound.body).toBeTruthy();

    const suggest = await request(app.getHttpServer())
      .post(`/api/ai/conversations/${conversationId}/suggest`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ tone: 'professional' })
      .expect(200);
    expect(suggest.body.ok).toBe(true);
    expect(suggest.body.followUpId || suggest.body.accepted).toBeTruthy();

    const followUpId = suggest.body.followUpId as string | undefined;
    if (followUpId) {
      await request(app.getHttpServer())
        .post(`/api/follow-ups/${followUpId}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect((res) => {
          if (![200, 201].includes(res.status)) {
            throw new Error(`approve unexpected ${res.status}`);
          }
        });

      await request(app.getHttpServer())
        .post(`/api/follow-ups/${followUpId}/execute`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect((res) => {
          if (![200, 201].includes(res.status)) {
            throw new Error(`execute unexpected ${res.status}`);
          }
        });
    } else {
      // Async AI path — create manual follow-up and execute
      const created = await request(app.getHttpServer())
        .post('/api/follow-ups')
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          leadId,
          conversationId,
          suggestedBody: 'Mensagem de follow-up do piloto',
          type: 'RECOVERY',
        })
        .expect(201);
      const fuId = created.body.id as string;
      await request(app.getHttpServer())
        .post(`/api/follow-ups/${fuId}/approve`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/follow-ups/${fuId}/execute`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({})
        .expect(200);
    }
  });

  it('memberships + diagnostics + export', async () => {
    const members = await request(app.getHttpServer())
      .get('/api/memberships')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(members.body.data.length).toBeGreaterThanOrEqual(1);

    const diag = await request(app.getHttpServer())
      .get('/api/ops/diagnostics')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(diag.body.scope).toBe('full');
    expect(diag.body.checks.postgres.status).toBe('ok');
    expect(diag.body.checks.redis.status).toBe('ok');

    const exportRes = await request(app.getHttpServer())
      .get('/api/exports/leads')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(exportRes.headers['content-type']).toMatch(/text\/csv/);
    expect(exportRes.text).toContain('id,name,phone');
  });

  it('dashboard + pipeline respond for pilot ops', async () => {
    await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/api/pipeline')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
  });

  it('fresh user can complete setup company onboarding (max 1)', async () => {
    const email = `stab-setup-${Date.now()}@test.autopilot.dev`;
    const passwordHash = await argon2.hash(E2E_PASSWORD);
    await prisma.user.create({
      data: {
        email,
        name: 'Stab Setup',
        status: UserStatus.ACTIVE,
        passwordHash,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email, password: E2E_PASSWORD })
      .expect(200);

    const token = loginRes.body.accessToken as string;
    const slug = `stab-${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/setup/company')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Stab Onboard Co', slug })
      .expect(201);
    expect(created.body.company.slug).toBe(slug);

    await request(app.getHttpServer())
      .post('/api/setup/company')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Second', slug: `${slug}-2` })
      .expect(409);
  });
});
