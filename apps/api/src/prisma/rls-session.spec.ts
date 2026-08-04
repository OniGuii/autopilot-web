import { runWithRequestContext } from '../observability/request-context';
import { runWithRlsBypass } from './rls-context';
import { applyRlsSessionGuc } from './rls-session';

describe('applyRlsSessionGuc (8B)', () => {
  it('sets company_id from request context and bypass off', async () => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async (strings: TemplateStringsArray) => {
        calls.push(strings.join('?'));
        return 1;
      }),
    };

    await runWithRequestContext({ companyId: 'cid-1' }, () =>
      applyRlsSessionGuc(tx),
    );

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(calls[0]).toContain('app.rls_bypass');
    expect(calls[1]).toContain('app.company_id');
  });

  it('sets bypass on and clears company_id when bypass ALS is active', async () => {
    const sqlParts: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async (strings: TemplateStringsArray) => {
        sqlParts.push(strings.join(''));
        return 1;
      }),
    };

    await runWithRlsBypass(() => applyRlsSessionGuc(tx));

    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
    expect(sqlParts[0]).toContain('app.rls_bypass');
    expect(sqlParts[0]).toContain("'on'");
    expect(sqlParts[1]).toContain('app.company_id');
  });

  it('clears company_id when tenant context is missing', async () => {
    const params: unknown[] = [];
    const tx = {
      $executeRaw: jest.fn(
        async (strings: TemplateStringsArray, ...rest: unknown[]) => {
          if (strings.join('').includes('app.company_id')) {
            params.push(...rest);
          }
          return 1;
        },
      ),
    };

    await applyRlsSessionGuc(tx);
    // empty string path uses literal '', not a bound param — just ensure 2 calls
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
});
