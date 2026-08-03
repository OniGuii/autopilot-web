import {
  canTransitionOutboundStatus,
  isRegressionOrInvalidTransition,
  OUTBOUND_MESSAGE_STATUS,
  PENDING_STALE_MINUTES,
} from './message-status';

describe('outbound message status machine (P3-D2)', () => {
  it('allows only the frozen transitions', () => {
    expect(
      canTransitionOutboundStatus(
        OUTBOUND_MESSAGE_STATUS.PENDING,
        OUTBOUND_MESSAGE_STATUS.SENT,
      ),
    ).toBe(true);
    expect(
      canTransitionOutboundStatus(
        OUTBOUND_MESSAGE_STATUS.PENDING,
        OUTBOUND_MESSAGE_STATUS.FAILED,
      ),
    ).toBe(true);
    expect(
      canTransitionOutboundStatus(
        OUTBOUND_MESSAGE_STATUS.SENT,
        OUTBOUND_MESSAGE_STATUS.DELIVERED,
      ),
    ).toBe(true);
    expect(
      canTransitionOutboundStatus(
        OUTBOUND_MESSAGE_STATUS.DELIVERED,
        OUTBOUND_MESSAGE_STATUS.READ,
      ),
    ).toBe(true);
  });

  it('rejects regressions and skips', () => {
    expect(
      canTransitionOutboundStatus(
        OUTBOUND_MESSAGE_STATUS.SENT,
        OUTBOUND_MESSAGE_STATUS.FAILED,
      ),
    ).toBe(false);
    expect(
      canTransitionOutboundStatus(
        OUTBOUND_MESSAGE_STATUS.SENT,
        OUTBOUND_MESSAGE_STATUS.READ,
      ),
    ).toBe(false);
    expect(
      canTransitionOutboundStatus(
        OUTBOUND_MESSAGE_STATUS.READ,
        OUTBOUND_MESSAGE_STATUS.DELIVERED,
      ),
    ).toBe(false);
    expect(
      isRegressionOrInvalidTransition(
        OUTBOUND_MESSAGE_STATUS.DELIVERED,
        OUTBOUND_MESSAGE_STATUS.SENT,
      ),
    ).toBe(true);
  });

  it('documents PENDING stale operational window (P3-D3)', () => {
    expect(PENDING_STALE_MINUTES).toBe(5);
  });
});
