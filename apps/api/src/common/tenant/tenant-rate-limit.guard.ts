import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../../auth/authenticated-user.interface';

const TENANT_LIMIT = 1000;
const TENANT_WINDOW_MS = 60_000;

/**
 * A second, independent rate limit on top of the IP-based ThrottlerGuard
 * (app.module.ts) - that one is keyed by caller IP, which does nothing to
 * stop one compromised/malicious tenant hammering the API from many
 * different IPs (a botnet, a misbehaving integration cycling through
 * proxies) while every individual IP stays under the per-IP limit. This
 * checks the OTHER axis: total requests for one organizationId, regardless
 * of how many IPs they're spread across.
 *
 * Registered as its own APP_GUARD AFTER JwtAuthGuard/RolesGuard (see
 * app.module.ts's guard-order comment) rather than as a second named
 * throttler on the existing ThrottlerGuard - that guard runs FIRST,
 * specifically so IP throttling covers @Public() pre-auth routes, which
 * means req.user (and therefore organizationId) doesn't exist yet by the
 * time it runs. This guard needs the opposite ordering (organizationId
 * must already be resolved), so it's simplest and lowest-risk as its own
 * guard rather than restructuring the existing one.
 *
 * A generous 1000 req/min default: this codebase's own target scale
 * (DESIGN.md: 1-10 tenants, <10 terminals total) means even a busy branch
 * running every terminal flat out shouldn't come close to this - it's
 * meant to catch a runaway script or a genuinely compromised tenant, not
 * to throttle normal POS traffic. In-memory, same reasoning as
 * PinLockoutService: a rate-limit counter, not business data, at a scale
 * where a restart resetting it is an acceptable trade against a new
 * persisted store.
 */
@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  private readonly requestTimestamps = new Map<string, number[]>();

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const organizationId = request.user?.organizationId;
    // No tenant established yet (public/pre-auth route) - nothing to key
    // on, and the IP-based guard already covers this case.
    if (!organizationId) return true;

    const now = Date.now();
    const timestamps = (
      this.requestTimestamps.get(organizationId) ?? []
    ).filter((t) => now - t < TENANT_WINDOW_MS);

    if (timestamps.length >= TENANT_LIMIT) {
      this.requestTimestamps.set(organizationId, timestamps);
      throw new HttpException(
        'This organization has exceeded its request rate limit - please slow down and try again shortly',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    timestamps.push(now);
    this.requestTimestamps.set(organizationId, timestamps);
    return true;
  }
}
