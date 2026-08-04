import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../../modules/auth/types/jwt-payload';
import { requestContextAls } from '../../observability/request-context';

/**
 * Binds JWT.cid / JWT.sub into request context ALS (tenant + observability).
 * Preserves correlationId set by CorrelationMiddleware.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<{ user?: AuthenticatedUser; correlationId?: string }>();
    const companyId = request.user?.cid;
    const userId = request.user?.sub;
    const prev = requestContextAls.getStore() ?? {};
    const correlationId = prev.correlationId ?? request.correlationId;

    return new Observable((observer) => {
      const subscription = requestContextAls.run(
        {
          ...prev,
          companyId,
          userId,
          correlationId,
        },
        () => next.handle().subscribe(observer),
      );
      return () => subscription.unsubscribe();
    });
  }
}
