import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../../modules/auth/types/jwt-payload';
import { tenantAls } from './tenant-als';

/**
 * Binds JWT.cid (when present) into AsyncLocalStorage for the Prisma tenant extension.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser }>();
    const companyId = request.user?.cid;

    return new Observable((observer) => {
      const subscription = tenantAls.run({ companyId }, () =>
        next.handle().subscribe(observer),
      );
      return () => subscription.unsubscribe();
    });
  }
}
