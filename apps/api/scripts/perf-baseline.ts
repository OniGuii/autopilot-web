/**
 * Pilot Stabilization — local performance baseline.
 *
 * Usage (apps/api, DB+Redis up, seed:test applied):
 *   ASYNC_WORKERS_IN_API=false npm run perf:baseline
 */
import 'dotenv/config';

process.env.NODE_ENV = 'test';
process.env.ASYNC_WORKERS_IN_API = 'false';
process.env.ASYNC_INBOUND_ENABLED = 'false';
process.env.ASYNC_AI_ENABLED = 'false';

import { INestApplication } from '@nestjs/common';
import { WhatsAppConnectionStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { runWithTenant } from '../src/core/tenancy/tenant-als';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2eApp,
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from '../test/helpers/e2e-app';

type Sample = {
  name: string;
  samplesMs: number[];
  p50: number;
  p95: number;
  max: number;
  errors: number;
};

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function summarize(
  name: string,
  samplesMs: number[],
  errors: number,
): Sample {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    name,
    samplesMs,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
    errors,
  };
}

async function time(
  fn: () => Promise<unknown>,
  runs: number,
): Promise<{ samplesMs: number[]; errors: number }> {
  const samplesMs: number[] = [];
  let errors = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    try {
      await fn();
      samplesMs.push(Math.round(performance.now() - t0));
    } catch {
      errors += 1;
      samplesMs.push(Math.round(performance.now() - t0));
    }
  }
  return { samplesMs, errors };
}

async function auth(app: INestApplication): Promise<string> {
  const login = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: E2E_OWNER_EMAIL, password: E2E_PASSWORD });
  if (login.status !== 200) {
    throw new Error(`login failed: ${login.status} ${JSON.stringify(login.body)}`);
  }
  const select = await request(app.getHttpServer())
    .post('/api/auth/select-company')
    .set('Authorization', `Bearer ${login.body.accessToken}`)
    .send({ companySlug: E2E_COMPANY_SLUG });
  if (select.status !== 200) {
    throw new Error(
      `select-company failed: ${select.status} ${JSON.stringify(select.body)}`,
    );
  }
  return select.body.accessToken as string;
}

async function main() {
  const runs = Number(process.env.PERF_RUNS ?? 5);
  const app = await createE2eApp();
  const prisma = app.get(PrismaService);

  const company = await prisma.company.findFirst({
    where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
  });
  if (!company) {
    throw new Error('Missing test-fixture company — run npm run seed:test');
  }

  const instanceKey = randomUUID();
  const secret = 'perf-baseline-secret';
  const hash = await argon2.hash(secret);

  await runWithTenant(company.id, async () => {
    const existing = await prisma.whatsAppInstance.findFirst({
      where: { companyId: company.id, deletedAt: null },
    });
    if (existing) {
      await prisma.whatsAppInstance.update({
        where: { id: existing.id },
        data: {
          instanceKey,
          status: WhatsAppConnectionStatus.CONNECTED,
          webhookSecretHash: hash,
          evolutionInstanceName: `ap-perf-${instanceKey.slice(0, 8)}`,
          connectedAt: new Date(),
        },
      });
    } else {
      await prisma.whatsAppInstance.create({
        data: {
          companyId: company.id,
          instanceKey,
          evolutionInstanceName: `ap-perf-${instanceKey.slice(0, 8)}`,
          status: WhatsAppConnectionStatus.CONNECTED,
          webhookSecretHash: hash,
          phoneNumber: '5511977776666',
          connectedAt: new Date(),
        },
      });
    }
  });

  const results: Sample[] = [];

  // Benchmark login first — each login may revoke older sessions (max concurrency).
  const loginT = await time(
    () =>
      request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: E2E_OWNER_EMAIL, password: E2E_PASSWORD }),
    runs,
  );
  results.push(summarize('login', loginT.samplesMs, loginT.errors));

  // Fresh company-scoped token after login churn.
  const token = await auth(app);

  let leadSeq = 0;
  const leadT = await time(async () => {
    leadSeq += 1;
    const phone = `+5511977${String(Date.now()).slice(-6)}${String(leadSeq).padStart(3, '0')}`;
    const res = await request(app.getHttpServer())
      .post('/api/leads')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Perf Lead', phone, source: 'MANUAL' });
    if (res.status >= 400) {
      throw new Error(`lead ${res.status} ${JSON.stringify(res.body)}`);
    }
  }, runs);
  results.push(summarize('create_lead', leadT.samplesMs, leadT.errors));

  const phone = `+5511966${String(Date.now()).slice(-7)}`;
  const leadRes = await request(app.getHttpServer())
    .post('/api/leads')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Perf Conv Lead', phone });
  const leadId = leadRes.body.id as string;
  const inboundPhone = phone.replace('+', '');
  const inbound = await request(app.getHttpServer())
    .post(`/api/whatsapp/webhook/${instanceKey}`)
    .set('X-Webhook-Secret', secret)
    .send({
      event: 'messages.upsert',
      data: {
        key: {
          remoteJid: `${inboundPhone}@s.whatsapp.net`,
          fromMe: false,
          id: `PERF_${Date.now()}`,
        },
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: 'perf inbound' },
      },
    });
  let conversationId = inbound.body.conversationId as string | undefined;
  if (!conversationId) {
    conversationId = (
      await runWithTenant(company.id, () =>
        prisma.conversation.findFirst({
          where: { leadId, deletedAt: null },
        }),
      )
    )?.id;
  }

  if (!conversationId) {
    throw new Error('Failed to resolve conversationId for perf send/ai');
  }

  const sendT = await time(async () => {
    const res = await request(app.getHttpServer())
      .post('/api/whatsapp/send')
      .set('Authorization', `Bearer ${token}`)
      .send({
        leadId,
        conversationId,
        body: `perf outbound ${Date.now()}-${Math.random()}`,
      });
    if (res.status >= 400) {
      throw new Error(`send ${res.status} ${JSON.stringify(res.body)}`);
    }
  }, runs);
  results.push(summarize('send_whatsapp', sendT.samplesMs, sendT.errors));

  const aiT = await time(async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/ai/conversations/${conversationId}/suggest`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tone: 'concise' });
    if (res.status >= 400) throw new Error(`ai ${res.status}`);
  }, Math.min(runs, 3));
  results.push(summarize('ai_suggest', aiT.samplesMs, aiT.errors));

  const dashT = await time(async () => {
    const res = await request(app.getHttpServer())
      .get('/api/dashboard')
      .set('Authorization', `Bearer ${token}`);
    if (res.status >= 400) throw new Error(`dash ${res.status}`);
  }, runs);
  results.push(summarize('dashboard', dashT.samplesMs, dashT.errors));

  const pipeT = await time(async () => {
    const res = await request(app.getHttpServer())
      .get('/api/pipeline')
      .set('Authorization', `Bearer ${token}`);
    if (res.status >= 400) throw new Error(`pipe ${res.status}`);
  }, runs);
  results.push(summarize('pipeline', pipeT.samplesMs, pipeT.errors));

  const expT = await time(async () => {
    const res = await request(app.getHttpServer())
      .get('/api/exports/leads')
      .set('Authorization', `Bearer ${token}`);
    if (res.status >= 400) throw new Error(`export ${res.status}`);
  }, runs);
  results.push(summarize('exports_leads', expT.samplesMs, expT.errors));

  const report = {
    generatedAt: new Date().toISOString(),
    env: {
      nodeEnv: process.env.NODE_ENV,
      runs,
      companySlug: E2E_COMPANY_SLUG,
      evolutionStub: !process.env.EVOLUTION_API_URL,
      asyncAi: process.env.ASYNC_AI_ENABLED ?? 'false',
      workersInApi: process.env.ASYNC_WORKERS_IN_API ?? 'false',
    },
    results,
    notes: [
      'Local in-process Nest app (same bootstrap as e2e).',
      'OpenAI stub (NODE_ENV=test, empty key).',
      'Evolution stub (empty EVOLUTION_API_URL).',
      'Not a production load test — use as pilot readiness baseline only.',
    ],
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
