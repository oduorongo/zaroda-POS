import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { tenantContext, TenantStore } from './tenant-context';
import { AuthenticatedUser } from '../../auth/authenticated-user.interface';

/**
 * Runs after guards (unlike middleware, which runs before them - so
 * middleware can't see req.user yet). Wraps the rest of the request
 * pipeline in tenantContext.run() so every service/repository call
 * downstream, including ones several layers deep, can read the current
 * tenant via getTenantStore() without it being threaded through as a
 * parameter everywhere.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      // Unauthenticated route (e.g. /auth/login) - nothing to scope, let it through untouched.
      return next.handle();
    }

    const store: TenantStore = {
      organizationId: user.organizationId,
      orgUserId: user.orgUserId,
      role: user.role,
    };

    let result: Observable<unknown> | undefined;
    tenantContext.run(store, () => {
      result = next.handle();
    });
    return result as Observable<unknown>;
  }
}
