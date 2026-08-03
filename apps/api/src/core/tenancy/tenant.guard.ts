import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import {
  AuthenticatedUser,
  hasCompanyContext,
} from '../../modules/auth/types/jwt-payload';

/**
 * Ensures the request has company context (JWT mid/cid/role).
 * Prefer CompanyContextGuard on controllers; this guard is available for core wiring.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user || !hasCompanyContext(user)) {
      throw new ForbiddenException(
        'Company context required. Call POST /auth/select-company.',
      );
    }
    return true;
  }
}
