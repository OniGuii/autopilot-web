import {
  getRlsTxDepth,
  isRlsBypass,
  runWithRlsBypass,
  runWithRlsBypassAsync,
  runWithRlsTxDepth,
} from './rls-context';

describe('rls-context (8B)', () => {
  it('defaults bypass and depth to off/0', () => {
    expect(isRlsBypass()).toBe(false);
    expect(getRlsTxDepth()).toBe(0);
  });

  it('runWithRlsBypass scopes the flag', () => {
    expect(isRlsBypass()).toBe(false);
    runWithRlsBypass(() => {
      expect(isRlsBypass()).toBe(true);
    });
    expect(isRlsBypass()).toBe(false);
  });

  it('runWithRlsBypassAsync scopes the flag for async work', async () => {
    await runWithRlsBypassAsync(async () => {
      expect(isRlsBypass()).toBe(true);
      await Promise.resolve();
      expect(isRlsBypass()).toBe(true);
    });
    expect(isRlsBypass()).toBe(false);
  });

  it('runWithRlsTxDepth nests depth', () => {
    runWithRlsTxDepth(1, () => {
      expect(getRlsTxDepth()).toBe(1);
      runWithRlsTxDepth(2, () => {
        expect(getRlsTxDepth()).toBe(2);
      });
      expect(getRlsTxDepth()).toBe(1);
    });
    expect(getRlsTxDepth()).toBe(0);
  });
});
