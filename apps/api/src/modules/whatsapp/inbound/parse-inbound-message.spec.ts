import {
  extractExternalEventId,
  isMessageEvent,
  parseInboundMessage,
} from './parse-inbound-message';

describe('parseInboundMessage', () => {
  const base = {
    event: 'messages.upsert',
    data: {
      key: {
        remoteJid: '5511987654321@s.whatsapp.net',
        fromMe: false,
        id: 'MSG_ABC_001',
      },
      pushName: 'Cliente',
      messageType: 'conversation',
      messageTimestamp: 1_720_000_000,
      message: {
        conversation: 'Olá, tenho interesse',
      },
    },
  };

  it('parses a standard Evolution text upsert', () => {
    const result = parseInboundMessage(base);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.remotePhone).toBe('5511987654321');
    expect(result.message.externalMessageId).toBe('MSG_ABC_001');
    expect(result.message.body).toBe('Olá, tenho interesse');
    expect(result.message.fromMe).toBe(false);
  });

  it('ignores echo fromMe', () => {
    const result = parseInboundMessage({
      ...base,
      data: {
        ...base.data,
        key: { ...base.data.key, fromMe: true },
      },
    });
    expect(result).toEqual({ ok: false, reason: 'ECHO_FROM_ME' });
  });

  it('ignores groups', () => {
    const result = parseInboundMessage({
      ...base,
      data: {
        ...base.data,
        key: {
          ...base.data.key,
          remoteJid: '120363@g.us',
        },
      },
    });
    expect(result).toEqual({ ok: false, reason: 'GROUP' });
  });

  it('ignores non-text without caption', () => {
    const result = parseInboundMessage({
      ...base,
      data: {
        ...base.data,
        message: { imageMessage: { mimetype: 'image/jpeg' } },
      },
    });
    expect(result).toEqual({ ok: false, reason: 'NON_TEXT' });
  });

  it('accepts image caption as text body', () => {
    const result = parseInboundMessage({
      ...base,
      data: {
        ...base.data,
        message: { imageMessage: { caption: '  foto do carro  ' } },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message.body).toBe('foto do carro');
  });

  it('requires external message id', () => {
    const result = parseInboundMessage({
      ...base,
      data: {
        ...base.data,
        key: { remoteJid: base.data.key.remoteJid, fromMe: false, id: '' },
      },
    });
    expect(result).toEqual({
      ok: false,
      reason: 'MISSING_EXTERNAL_MESSAGE_ID',
    });
  });

  it('supports data as array', () => {
    const result = parseInboundMessage({
      event: 'messages.upsert',
      data: [base.data],
    });
    expect(result.ok).toBe(true);
  });
});

describe('isMessageEvent / extractExternalEventId', () => {
  it('detects messages.upsert variants', () => {
    expect(isMessageEvent('messages.upsert')).toBe(true);
    expect(isMessageEvent('MESSAGES_UPSERT')).toBe(true);
    expect(isMessageEvent('connection.update')).toBe(false);
  });

  it('extracts provider event id when present', () => {
    expect(extractExternalEventId({ id: 'evt-1', data: {} })).toBe('evt-1');
    expect(extractExternalEventId({ event: 'messages.upsert' })).toBeNull();
  });
});
