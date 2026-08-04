import { getTenantCompanyId } from '../core/tenancy/tenant-als';
import { isRlsBypass } from './rls-context';

type RawTx = {
  $executeRaw: (
    ...args: [TemplateStringsArray, ...unknown[]]
  ) => Promise<unknown>;
};

/**
 * SET LOCAL app.company_id / app.rls_bypass on the current transaction connection.
 */
export async function applyRlsSessionGuc(tx: RawTx): Promise<void> {
  if (isRlsBypass()) {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    await tx.$executeRaw`SELECT set_config('app.company_id', '', true)`;
    return;
  }

  const companyId = getTenantCompanyId();
  await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'off', true)`;
  if (companyId) {
    await tx.$executeRaw`SELECT set_config('app.company_id', ${companyId}, true)`;
  } else {
    await tx.$executeRaw`SELECT set_config('app.company_id', '', true)`;
  }
}
