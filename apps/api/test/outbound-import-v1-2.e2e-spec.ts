import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createE2eApp,
  E2E_COMPANY_SLUG,
  E2E_OWNER_EMAIL,
  E2E_PASSWORD,
} from './helpers/e2e-app';

async function authAsOwner(app: INestApplication<App>): Promise<string> {
  const loginRes = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: E2E_OWNER_EMAIL, password: E2E_PASSWORD })
    .expect(200);

  const selectRes = await request(app.getHttpServer())
    .post('/api/auth/select-company')
    .set(
      'Authorization',
      `Bearer ${(loginRes.body as { accessToken: string }).accessToken}`,
    )
    .send({ companySlug: E2E_COMPANY_SLUG })
    .expect(200);

  return (selectRes.body as { accessToken: string }).accessToken;
}

describe('Outbound Lead Import V1.2 (e2e)', () => {
  let app: INestApplication<App>;
  let token: string;
  let companyId: string;

  beforeAll(async () => {
    app = await createE2eApp();
    token = await authAsOwner(app);
    const prisma = app.get(PrismaService);
    const company = await prisma.company.findFirst({
      where: { slug: E2E_COMPANY_SLUG, deletedAt: null },
    });
    companyId = company!.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('paste → map → validate → commit creates leads', async () => {
    const suffix = String(Date.now()).slice(-6);
    const phoneA = `551198${suffix}`; // 12 digits BR
    const phoneB = `551199${suffix}`;

    const pasteRes = await request(app.getHttpServer())
      .post('/api/outbound/import/batches/paste')
      .set('Authorization', `Bearer ${token}`)
      .send({
        text: `Nome,Telefone,Cidade,Produto,Valor,Origem,Observação\nAna,${phoneA},SP,Consórcio,50000,META,teste\nBruno,${phoneB},RJ,Crédito,30000,INDICACAO,ok\n`,
        sourceDefault: 'OUTBOUND_IMPORT',
      })
      .expect(201);

    expect(pasteRes.body).toEqual(
      expect.objectContaining({
        companyId,
        status: 'UPLOADED',
        inputKind: 'PASTE',
        rowCount: 2,
      }),
    );
    expect(pasteRes.body.columnHeaders).toEqual(
      expect.arrayContaining(['Telefone', 'Nome']),
    );

    const batchId = pasteRes.body.id as string;

    const mapRes = await request(app.getHttpServer())
      .patch(`/api/outbound/import/batches/${batchId}/mapping`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        columnMapping: {
          phone: 'Telefone',
          name: 'Nome',
          city: 'Cidade',
          product: 'Produto',
          value: 'Valor',
          source: 'Origem',
          notes: 'Observação',
        },
        dedupeMode: 'skip',
      })
      .expect(200);

    expect(mapRes.body.status).toBe('MAPPING');
    expect(mapRes.body.columnMapping.phone).toBe('Telefone');

    const validateRes = await request(app.getHttpServer())
      .post(`/api/outbound/import/batches/${batchId}/validate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(validateRes.body.status).toBe('VALIDATED');
    expect(validateRes.body.report).toEqual(
      expect.objectContaining({
        total: 2,
        valid: expect.any(Number),
      }),
    );
    expect(validateRes.body.report.valid).toBeGreaterThanOrEqual(1);

    const commitRes = await request(app.getHttpServer())
      .post(`/api/outbound/import/batches/${batchId}/commit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    expect(commitRes.body.status).toBe('COMPLETED');
    expect(commitRes.body.report.created).toBeGreaterThanOrEqual(1);
    expect(commitRes.body.report.valid).toBe(commitRes.body.report.created);

    // Verify via API (RLS requires company context — raw Prisma after request is empty).
    const leadsRes = await request(app.getHttpServer())
      .get('/api/leads')
      .query({ search: phoneA.slice(-8), limit: 50 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const phones = (leadsRes.body.data as Array<{ phone: string }>).map(
      (l) => l.phone,
    );
    expect(phones.some((p) => p === phoneA || p === phoneB)).toBe(true);

    const batchGet = await request(app.getHttpServer())
      .get(`/api/outbound/import/batches/${batchId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(batchGet.body.status).toBe('COMPLETED');
  });

  it('GET dashboard returns import metrics', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/outbound/import/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual(
      expect.objectContaining({
        companyId,
        metrics: expect.objectContaining({
          imported: expect.any(Number),
          valid: expect.any(Number),
          invalid: expect.any(Number),
          duplicates: expect.any(Number),
          ignored: expect.any(Number),
          created: expect.any(Number),
        }),
      }),
    );
  });

  it('upload CSV file creates batch', async () => {
    const suffix = String(Date.now()).slice(-6);
    const phone = `551188${suffix}`;
    const csv = `Nome,Telefone\nCarla,${phone}\n`;

    const res = await request(app.getHttpServer())
      .post('/api/outbound/import/batches/upload')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(csv, 'utf8'), {
        filename: 'leads.csv',
        contentType: 'text/csv',
      })
      .expect(201);

    expect(res.body.inputKind).toBe('CSV');
    expect(res.body.rowCount).toBe(1);
    expect(res.body.previewSample.length).toBeGreaterThan(0);
  });
});
