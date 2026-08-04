import {
  OUTBOUND_MESSAGE_STATUS,
  type OutboundMessageStatus,
} from './message-status';

type UnknownRecord = Record<string, unknown>;

export type ParsedDeliveryUpdate = {
  externalMessageId: string;
  targetStatus: OutboundMessageStatus;
  errorMessage: string | null;
  occurredAt: Date;
};

export type ParseDeliveryResult =
  { ok: true; update: ParsedDeliveryUpdate } | { ok: false; reason: string };

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function firstDataNode(payload: UnknownRecord): UnknownRecord | null {
  const data = payload.data ?? payload;
  if (Array.isArray(data)) {
    return asRecord(data[0]);
  }
  return asRecord(data);
}

function extractExternalId(node: UnknownRecord): string | null {
  const key = asRecord(node.key);
  const candidates = [
    key?.id,
    node.keyId,
    node.messageId,
    node.id,
    asRecord(node.message)?.key && asRecord(asRecord(node.message)!.key)?.id,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) {
      return c.trim().slice(0, 191);
    }
  }
  return null;
}

function mapStatus(raw: unknown): OutboundMessageStatus | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Baileys ack-style numbers (best-effort)
    if (raw === 0) return OUTBOUND_MESSAGE_STATUS.FAILED;
    if (raw === 1 || raw === 2) return OUTBOUND_MESSAGE_STATUS.SENT;
    if (raw === 3) return OUTBOUND_MESSAGE_STATUS.DELIVERED;
    if (raw === 4 || raw === 5) return OUTBOUND_MESSAGE_STATUS.READ;
    return null;
  }

  if (typeof raw !== 'string') return null;
  const n = raw.toLowerCase().replace(/[.\s-]/g, '_');

  if (
    n.includes('fail') ||
    n.includes('error') ||
    n === 'message_failed' ||
    n === 'messages_failed'
  ) {
    return OUTBOUND_MESSAGE_STATUS.FAILED;
  }
  if (
    n.includes('read') ||
    n.includes('played') ||
    n === 'message_read' ||
    n === 'read_ack'
  ) {
    return OUTBOUND_MESSAGE_STATUS.READ;
  }
  if (
    n.includes('deliver') ||
    n === 'delivery_ack' ||
    n === 'message_delivered'
  ) {
    return OUTBOUND_MESSAGE_STATUS.DELIVERED;
  }
  if (
    n.includes('sent') ||
    n === 'server_ack' ||
    n === 'message_sent' ||
    n === 'pending'
  ) {
    // SERVER_ACK / message.sent → SENT
    if (n === 'pending') return OUTBOUND_MESSAGE_STATUS.SENT;
    return OUTBOUND_MESSAGE_STATUS.SENT;
  }

  return null;
}

export function isDeliveryEvent(eventName: string | null): boolean {
  if (!eventName) return false;
  const n = eventName.toLowerCase();
  if (n.includes('upsert')) return false;
  if (n.includes('connection')) return false;

  return (
    n === 'messages.update' ||
    n === 'messages_update' ||
    n === 'message.sent' ||
    n === 'message.delivered' ||
    n === 'message.read' ||
    n === 'message.failed' ||
    n === 'messages.sent' ||
    n === 'send.message' ||
    (n.includes('message') &&
      (n.includes('update') ||
        n.includes('ack') ||
        n.includes('sent') ||
        n.includes('deliver') ||
        n.includes('read') ||
        n.includes('fail')))
  );
}

/**
 * Map Evolution delivery/ack payloads to domain status updates.
 */
export function parseDeliveryUpdate(
  payload: UnknownRecord,
  eventName: string | null,
): ParseDeliveryResult {
  const node = firstDataNode(payload);
  if (!node) {
    return { ok: false, reason: 'MISSING_DATA' };
  }

  const externalMessageId = extractExternalId(node);
  if (!externalMessageId) {
    return { ok: false, reason: 'MISSING_EXTERNAL_MESSAGE_ID' };
  }

  const statusRaw =
    node.status ??
    node.ack ??
    node.messageStatus ??
    asRecord(node.update)?.status ??
    eventName;

  let targetStatus = mapStatus(statusRaw);
  if (!targetStatus && eventName) {
    targetStatus = mapStatus(eventName);
  }
  if (!targetStatus) {
    return { ok: false, reason: 'UNMAPPED_STATUS' };
  }

  const errorMessage =
    typeof node.error === 'string'
      ? node.error.slice(0, 1000)
      : typeof node.message === 'string' && targetStatus === 'FAILED'
        ? node.message.slice(0, 1000)
        : null;

  return {
    ok: true,
    update: {
      externalMessageId,
      targetStatus,
      errorMessage,
      occurredAt: new Date(),
    },
  };
}
