import {
  isDeliveryEvent,
  parseDeliveryUpdate,
} from './parse-delivery-update';
import { OUTBOUND_MESSAGE_STATUS } from './message-status';

describe('parseDeliveryUpdate', () => {
  it('detects delivery events and not upserts', () => {
    expect(isDeliveryEvent('messages.update')).toBe(true);
    expect(isDeliveryEvent('message.delivered')).toBe(true);
    expect(isDeliveryEvent('messages.upsert')).toBe(false);
    expect(isDeliveryEvent('connection.update')).toBe(false);
  });

  it('maps DELIVERY_ACK to DELIVERED', () => {
    const result = parseDeliveryUpdate(
      {
        event: 'messages.update',
        data: { keyId: 'ABC', status: 'DELIVERY_ACK' },
      },
      'messages.update',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.update.externalMessageId).toBe('ABC');
    expect(result.update.targetStatus).toBe(OUTBOUND_MESSAGE_STATUS.DELIVERED);
  });

  it('maps message.read event name', () => {
    const result = parseDeliveryUpdate(
      {
        event: 'message.read',
        data: { key: { id: 'R1', fromMe: true } },
      },
      'message.read',
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.update.targetStatus).toBe(OUTBOUND_MESSAGE_STATUS.READ);
  });
});
