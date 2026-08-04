import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { AuthenticatedUser, hasCompanyContext } from '../types/jwt-payload';

/**
 * Requires access token with membership/company context
 * (after POST /auth/select-company).
 */
@Injectable()
export class CompanyContextGuard implements CanActivate {
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
