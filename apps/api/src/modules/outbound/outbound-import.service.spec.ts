import { LeadStatus } from '@prisma/client';
import { OutboundImportService } from './outbound-import.service';
import { OUTBOUND_IMPORT_STATUSES } from './outbound-import.constants';

describe('OutboundImportService (V1.2)', () => {
  const prisma = {
    leadImportBatch: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
    },
    lead: { findFirst: jest.fn(), create: jest.fn() },
    leadStatusTransition: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const audit = { write: jest.fn() };
  const suppress = { isSuppressed: jest.fn() };
  const prom = {
    recordOutboundImportUploaded: jest.fn(),
    recordOutboundImportValidated: jest.fn(),
    recordOutboundImportCommitted: jest.fn(),
    recordOutboundImportSkipped: jest.fn(),
    recordOutboundImportFailed: jest.fn(),
  };

  let service: OutboundImportService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prisma) => Promise<unknown>) => fn(prisma),
    );
    suppress.isSuppressed.mockResolvedValue(false);
    prisma.lead.findFirst.mockResolvedValue(null);
    service = new OutboundImportService(
      prisma as never,
      audit as never,
      suppress as never,
      prom as never,
    );
  });

  it('creates batch from paste and guesses mapping', async () => {
    const created = {
      id: 'b1',
      companyId: 'c1',
      createdByUserId: 'u1',
      status: OUTBOUND_IMPORT_STATUSES.UPLOADED,
      inputKind: 'PASTE',
      filename: 'paste.tsv',
      contentType: 'text/tab-separated-values',
      fileHash: 'abc',
      byteSize: 10,
      rowCount: 1,
      columnHeaders: ['Nome', 'Telefone'],
      columnMapping: { phone: 'Telefone', name: 'Nome' },
      sourceDefault: 'OUTBOUND_IMPORT',
      dedupeMode: 'skip',
      stagedData: {
        headers: ['Nome', 'Telefone'],
        rows: [['Ana', '11987654321']],
      },
      previewSample: [{ Nome: 'Ana', Telefone: '11987654321' }],
      report: null,
      errorMessage: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    prisma.leadImportBatch.create.mockResolvedValue(created);

    const result = await service.createFromPaste(
      { cid: 'c1', sub: 'u1' },
      { text: 'Nome\tTelefone\nAna\t11987654321\n' },
    );

    expect(result.status).toBe('UPLOADED');
    expect(result.rowCount).toBe(1);
    expect(result.columnHeaders).toContain('Telefone');
    expect(prom.recordOutboundImportUploaded).toHaveBeenCalledWith(1);
    expect(audit.write).toHaveBeenCalled();
  });

  it('validate marks suppress and duplicates', async () => {
    const batch = {
      id: 'b1',
      companyId: 'c1',
      createdByUserId: 'u1',
      status: OUTBOUND_IMPORT_STATUSES.MAPPING,
      inputKind: 'PASTE',
      filename: 'paste.tsv',
      contentType: null,
      fileHash: null,
      byteSize: null,
      rowCount: 2,
      columnHeaders: ['Telefone'],
      columnMapping: { phone: 'Telefone' },
      sourceDefault: 'OUTBOUND_IMPORT',
      dedupeMode: 'skip',
      stagedData: {
        headers: ['Telefone'],
        rows: [['11987654321'], ['11987654321']],
      },
      previewSample: [],
      report: null,
      errorMessage: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    prisma.leadImportBatch.findFirst.mockResolvedValue(batch);
    prisma.leadImportBatch.update.mockResolvedValue({
      ...batch,
      status: OUTBOUND_IMPORT_STATUSES.VALIDATED,
      report: { valid: 1, duplicates: 1 },
    });

    const result = await service.validate({ cid: 'c1', sub: 'u1' }, 'b1');
    expect(result.status).toBe('VALIDATED');
    expect(prom.recordOutboundImportValidated).toHaveBeenCalled();
  });

  it('commit creates Lead NEW rows', async () => {
    const batch = {
      id: 'b1',
      companyId: 'c1',
      createdByUserId: 'u1',
      status: OUTBOUND_IMPORT_STATUSES.VALIDATED,
      inputKind: 'PASTE',
      filename: 'paste.tsv',
      contentType: null,
      fileHash: null,
      byteSize: null,
      rowCount: 1,
      columnHeaders: ['Nome', 'Telefone'],
      columnMapping: { phone: 'Telefone', name: 'Nome' },
      sourceDefault: 'OUTBOUND_IMPORT',
      dedupeMode: 'skip',
      stagedData: {
        headers: ['Nome', 'Telefone'],
        rows: [['Ana', '11987654321']],
      },
      previewSample: [],
      report: null,
      errorMessage: null,
      committedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    prisma.leadImportBatch.findFirst.mockResolvedValue(batch);
    prisma.leadImportBatch.update
      .mockResolvedValueOnce({
        ...batch,
        status: OUTBOUND_IMPORT_STATUSES.COMMITTING,
      })
      .mockResolvedValueOnce({
        ...batch,
        status: OUTBOUND_IMPORT_STATUSES.COMPLETED,
        report: { created: 1, valid: 1 },
        committedAt: new Date(),
      });
    prisma.lead.create.mockResolvedValue({
      id: 'lead-1',
      status: LeadStatus.NEW,
      phone: '5511987654321',
    });

    const result = await service.commit({ cid: 'c1', sub: 'u1' }, 'b1');
    expect(result.status).toBe('COMPLETED');
    expect(prisma.lead.create).toHaveBeenCalled();
    expect(prom.recordOutboundImportCommitted).toHaveBeenCalledWith(1);
  });
});
