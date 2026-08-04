import { ConflictException, NotFoundException } from '@nestjs/common';
import { CompanyCurrency, Prisma } from '@prisma/client';
import { CompaniesService } from './companies.service';

describe('CompaniesService', () => {
  const actor = { sub: 'user-1', cid: 'co-1', role: 'OWNER' } as never;
  const company = {
    id: 'co-1',
    name: 'Acme',
    slug: 'acme',
    timezone: 'America/Sao_Paulo',
    locale: 'pt-BR',
    businessHours: null,
    logoUrl: null,
    currency: CompanyCurrency.BRL,
    updatedAt: new Date('2026-08-04T00:00:00.000Z'),
  };

  function build(overrides?: {
    findFirst?: jest.Mock;
    update?: jest.Mock;
    transaction?: jest.Mock;
  }) {
    const audit = { write: jest.fn().mockResolvedValue({ id: 'a1' }) };
    const prisma = {
      company: {
        findFirst: overrides?.findFirst ?? jest.fn().mockResolvedValue(company),
        update: overrides?.update ?? jest.fn(),
      },
      $transaction:
        overrides?.transaction ??
        jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
          fn({
            company: {
              update: jest.fn().mockResolvedValue({
                ...company,
                name: 'Acme Updated',
                currency: CompanyCurrency.USD,
              }),
            },
            auditLog: { create: jest.fn() },
          }),
        ),
    };
    return {
      service: new CompaniesService(prisma as never, audit as never),
      audit,
      prisma,
    };
  }

  it('getSettings returns mapped fields', async () => {
    const { service } = build();
    const result = await service.getSettings(actor);
    expect(result).toMatchObject({
      id: 'co-1',
      name: 'Acme',
      currency: CompanyCurrency.BRL,
      locale: 'pt-BR',
    });
  });

  it('getSettings 404 when missing', async () => {
    const { service } = build({
      findFirst: jest.fn().mockResolvedValue(null),
    });
    await expect(service.getSettings(actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updateSettings writes COMPANY_SETTINGS_UPDATE', async () => {
    const { service, audit } = build();
    const result = await service.updateSettings(actor, {
      name: 'Acme Updated',
      currency: CompanyCurrency.USD,
    });
    expect(result.name).toBe('Acme Updated');
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'COMPANY_SETTINGS_UPDATE' }),
    );
  });

  it('maps slug unique conflict', async () => {
    const { service } = build({
      transaction: jest.fn().mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      ),
    });
    await expect(
      service.updateSettings(actor, { slug: 'taken' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
