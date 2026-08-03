import { Injectable } from '@nestjs/common';
import { getTenantCompanyId } from './tenant-als';

/**
 * Request helper for the active tenant (companyId from ALS / JWT.cid).
 */
@Injectable()
export class TenantContext {
  getCompanyId(): string | undefined {
    return getTenantCompanyId();
  }

  requireCompanyId(): string {
    const companyId = this.getCompanyId();
    if (!companyId) {
      throw new Error('Tenant context missing companyId');
    }
    return companyId;
  }
}
