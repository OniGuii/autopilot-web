import { normalizePhone } from '../../leads/utils/normalize-phone';

export type ParsedInboundMessage = {
  remotePhone: string;
  remoteJid: string;
  externalMessageId: string;
  body: string;
  fromMe: boolean;
  sentAt: Date;
  pushName: string | null;
  messageType: string | null;
  isGroup: boolean;
};

export type ParseInboundResult =
  { ok: true; message: ParsedInboundMessage } | { ok: false; reason: string };

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function extractTextBody(message: UnknownRecord | null): string | null {
  if (!message) return null;

  if (typeof message.conversation === 'string') {
    return message.conversation;
  }

  const extended = asRecord(message.extendedTextMessage);
  if (extended && typeof extended.text === 'string') {
    return extended.text;
  }

  const image = asRecord(message.imageMessage);
  if (image && typeof image.caption === 'string' && image.caption.trim()) {
    return image.caption;
  }

  const video = asRecord(message.videoMessage);
  if (video && typeof video.caption === 'string' && video.caption.trim()) {
    return video.caption;
  }

  const buttons = asRecord(message.buttonsResponseMessage);
  if (buttons && typeof buttons.selectedDisplayText === 'string') {
    return buttons.selectedDisplayText;
  }

  const list = asRecord(message.listResponseMessage);
  if (list && typeof list.title === 'string') {
    return list.title;
  }

  return null;
}

function parseTimestamp(raw: unknown): Date {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Evolution may send seconds or milliseconds
    return new Date(raw < 1e12 ? raw * 1000 : raw);
  }
  if (typeof raw === 'string' && raw.trim()) {
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) {
      return new Date(asNum < 1e12 ? asNum * 1000 : asNum);
    }
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function normalizeMessageNode(data: unknown): UnknownRecord | null {
  if (Array.isArray(data)) {
    return asRecord(data[0]);
  }
  const record = asRecord(data);
  if (!record) return null;

  // Some payloads nest under `messages`
  if (Array.isArray(record.messages)) {
    return asRecord(record.messages[0]);
  }
  return record;
}

/**
 * Parse Evolution-style messages.upsert (and close variants) into a domain DTO.
 * Ignores groups, echoes (fromMe), non-text without caption, and missing ids.
 */
export function parseInboundMessage(
  payload: UnknownRecord,
): ParseInboundResult {
  const dataNode = normalizeMessageNode(payload.data ?? payload);
  if (!dataNode) {
    return { ok: false, reason: 'MISSING_DATA' };
  }

  const key = asRecord(dataNode.key);
  if (!key) {
    return { ok: false, reason: 'MISSING_KEY' };
  }

  const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  if (!remoteJid) {
    return { ok: false, reason: 'MISSING_REMOTE_JID' };
  }

  const isGroup =
    remoteJid.endsWith('@g.us') ||
    remoteJid.includes('@g.us') ||
    Boolean(dataNode.isGroup);

  if (isGroup) {
    return { ok: false, reason: 'GROUP' };
  }

  const fromMe = Boolean(key.fromMe ?? dataNode.fromMe);
  if (fromMe) {
    return { ok: false, reason: 'ECHO_FROM_ME' };
  }

  const externalMessageId =
    typeof key.id === 'string' && key.id.trim()
      ? key.id.trim()
      : typeof dataNode.id === 'string' && dataNode.id.trim()
        ? dataNode.id.trim()
        : '';

  if (!externalMessageId) {
    return { ok: false, reason: 'MISSING_EXTERNAL_MESSAGE_ID' };
  }

  const message = asRecord(dataNode.message);
  const bodyRaw = extractTextBody(message);
  if (bodyRaw === null) {
    return { ok: false, reason: 'NON_TEXT' };
  }

  const body = bodyRaw.trim();
  if (!body) {
    return { ok: false, reason: 'EMPTY_BODY' };
  }

  // Prefer participant/remote phone; strip device suffixes like :12
  const jidUser = remoteJid.split('@')[0]?.split(':')[0] ?? '';
  const remotePhone = normalizePhone(jidUser);
  if (!remotePhone || remotePhone.length < 8) {
    return { ok: false, reason: 'INVALID_PHONE' };
  }

  const pushName =
    typeof dataNode.pushName === 'string' ? dataNode.pushName : null;
  const messageType =
    typeof dataNode.messageType === 'string' ? dataNode.messageType : null;

  return {
    ok: true,
    message: {
      remotePhone,
      remoteJid,
      externalMessageId: externalMessageId.slice(0, 191),
      body: body.slice(0, 10000),
      fromMe: false,
      sentAt: parseTimestamp(dataNode.messageTimestamp ?? dataNode.timestamp),
      pushName,
      messageType,
      isGroup: false,
    },
  };
}

export function isMessageEvent(eventName: string | null): boolean {
  if (!eventName) return false;
  const n = eventName.toLowerCase();
  return (
    n === 'messages.upsert' ||
    n === 'messages_upsert' ||
    n.includes('messages.upsert') ||
    n.includes('messages_upsert') ||
    (n.includes('message') && n.includes('upsert'))
  );
}

/**
 * Provider event id for WebhookEvent idempotency — only when Evolution sends one.
 * Message-level dedupe uses Message.externalMessageId (never invent event ids).
 */
export function extractExternalEventId(payload: UnknownRecord): string | null {
  const candidates = [
    payload.id,
    payload.eventId,
    payload.event_id,
    asRecord(payload.data)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim().slice(0, 191);
    }
  }
  return null;
}
