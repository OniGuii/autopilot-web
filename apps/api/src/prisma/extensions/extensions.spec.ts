import {
  assertSameTenant,
  notDeletedWhere,
  SOFT_DELETE_MODELS,
  TENANT_SCOPED_MODELS,
} from './index';
import {
  getTenantCompanyId,
  runWithTenant,
} from '../../core/tenancy/tenant-als';

describe('Prisma extensions helpers (Production Readiness)', () => {
  it('SOFT_DELETE_MODELS includes WhatsApp + auth session models', () => {
    expect(SOFT_DELETE_MODELS).toEqual(
      expect.arrayContaining([
        'lead',
        'session',
        'refreshToken',
        'whatsAppInstance',
        'webhookEvent',
      ]),
    );
  });

  it('TENANT_SCOPED_MODELS includes WhatsApp models', () => {
    expect(TENANT_SCOPED_MODELS).toEqual(
      expect.arrayContaining(['whatsAppInstance', 'webhookEvent', 'lead']),
    );
  });

  it('notDeletedWhere injects deletedAt null without clobbering override', () => {
    expect(notDeletedWhere({ companyId: 'c1' })).toEqual({
      companyId: 'c1',
      deletedAt: null,
    });
    expect(
      notDeletedWhere({ companyId: 'c1', deletedAt: { not: null } }),
    ).toEqual({
      companyId: 'c1',
      deletedAt: { not: null },
    });
  });

  it('assertSameTenant fails closed on mismatch', () => {
    expect(() => assertSameTenant('a', 'b')).toThrow(/Cross-tenant/);
    expect(() => assertSameTenant('a', 'a')).not.toThrow();
  });

  it('tenant ALS isolates companyId per async context', async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all([
      runWithTenant('company-a', async () => {
        await Promise.resolve();
        seen.push(getTenantCompanyId());
      }),
      runWithTenant('company-b', async () => {
        await Promise.resolve();
        seen.push(getTenantCompanyId());
      }),
    ]);
    expect(seen).toContain('company-a');
    expect(seen).toContain('company-b');
  });
});
