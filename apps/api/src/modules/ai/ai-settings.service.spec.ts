import { AiAgentMode } from '@prisma/client';
import { AiSettingsService } from './ai-settings.service';

describe('AiSettingsService (11A)', () => {
  const companyId = '11111111-1111-1111-1111-111111111111';
  const actor = { cid: companyId, sub: 'owner-1' };
  const row = {
    id: 'settings-1',
    companyId,
    mode: AiAgentMode.ASSIST,
    maxAutoRepliesPerLeadDay: 3,
    createdAt: new Date('2026-08-07T00:00:00.000Z'),
    updatedAt: new Date('2026-08-07T00:00:00.000Z'),
  };

  const audit = { write: jest.fn().mockResolvedValue({ id: 'a1' }) };
  let prisma: {
    companyAiSettings: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let service: AiSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = {
      companyAiSettings: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          companyAiSettings: prisma.companyAiSettings,
          auditLog: { create: jest.fn() },
        }),
      ),
    };
    service = new AiSettingsService(prisma as never, audit as never);
  });

  it('defaults to ASSIST when creating', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue(null);
    prisma.companyAiSettings.create.mockResolvedValue(row);
    const settings = await service.getOrCreate(actor);
    expect(settings.mode).toBe(AiAgentMode.ASSIST);
    expect(settings.autoEnabled).toBe(false);
    expect(prisma.companyAiSettings.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId,
        mode: AiAgentMode.ASSIST,
      }),
    });
  });

  it('updates mode and audits', async () => {
    prisma.companyAiSettings.findFirst.mockResolvedValue(row);
    prisma.companyAiSettings.update.mockResolvedValue({
      ...row,
      mode: AiAgentMode.OFF,
    });
    const updated = await service.update(actor, { mode: AiAgentMode.OFF });
    expect(updated.mode).toBe(AiAgentMode.OFF);
    expect(updated.autoEnabled).toBe(false);
    expect(audit.write).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'AI_SETTINGS_UPDATE' }),
    );
  });
});
