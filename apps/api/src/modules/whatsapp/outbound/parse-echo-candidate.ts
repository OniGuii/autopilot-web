import { normalizePhone } from '../../leads/utils/normalize-phone';

export type EchoCandidate = {
  remotePhone: string;
  remoteJid: string;
  externalMessageId: string;
  body: string | null;
};

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function extractTextBody(message: UnknownRecord | null): string | null {
  if (!message) return null;
  if (typeof message.conversation === 'string') return message.conversation;
  const extended = asRecord(message.extendedTextMessage);
  if (extended && typeof extended.text === 'string') return extended.text;
  return null;
}

function normalizeMessageNode(data: unknown): UnknownRecord | null {
  if (Array.isArray(data)) return asRecord(data[0]);
  const record = asRecord(data);
  if (!record) return null;
  if (Array.isArray(record.messages)) return asRecord(record.messages[0]);
  return record;
}

/**
 * Extract fromMe upsert fields for Echo Protection heal race (P3-E2).
 * Returns null when payload is not a usable fromMe echo.
 */
export function parseEchoCandidate(
  payload: UnknownRecord,
): EchoCandidate | null {
  const dataNode = normalizeMessageNode(payload.data ?? payload);
  if (!dataNode) return null;

  const key = asRecord(dataNode.key);
  if (!key) return null;

  const fromMe = Boolean(key.fromMe ?? dataNode.fromMe);
  if (!fromMe) return null;

  const remoteJid = typeof key.remoteJid === 'string' ? key.remoteJid : '';
  if (!remoteJid || remoteJid.includes('@g.us')) return null;

  const externalMessageId =
    typeof key.id === 'string' && key.id.trim() ? key.id.trim() : '';
  if (!externalMessageId) return null;

  const jidUser = remoteJid.split('@')[0]?.split(':')[0] ?? '';
  const remotePhone = normalizePhone(jidUser);
  if (!remotePhone) return null;

  const bodyRaw = extractTextBody(asRecord(dataNode.message));
  const body = bodyRaw?.trim() ? bodyRaw.trim().slice(0, 10000) : null;

  return {
    remotePhone,
    remoteJid,
    externalMessageId: externalMessageId.slice(0, 191),
    body,
  };
}
