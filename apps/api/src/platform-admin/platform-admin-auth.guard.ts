import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * The ONLY guard that can ever authenticate a request against
 * PlatformAdmin/PlatformAuditLog data or any cross-tenant query. Platform-
 * admin routes are marked @Public() to skip the global JwtAuthGuard (see
 * app.module.ts) entirely, then this is applied explicitly instead - so a
 * tenant-issued JWT (different secret, different payload shape - see
 * PlatformAdminJwtStrategy) can never reach these routes, and this guard
 * can never accidentally get applied to a tenant-facing route either
 * (nothing wires it globally).
 *
 * Sets `request.user = { platformAdminId }` (Passport's normal behavior,
 * not overridden) - the global TenantContextInterceptor treats any
 * truthy request.user as "establish a tenant context" and will build one
 * with `organizationId: undefined`, which is inert (no platform-admin
 * service ever calls getTenantStore()) but worth noting rather than
 * silently relying on.
 */
@Injectable()
export class PlatformAdminAuthGuard extends AuthGuard('platform-admin-jwt') {}
