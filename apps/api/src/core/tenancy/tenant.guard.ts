import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

/**
 * Scaffold: will enforce tenant presence and isolation.
 * No business logic in this foundation stage.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(_context: ExecutionContext): boolean {
    return true;
  }
}
