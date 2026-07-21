import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';

/**
 * Deliberately a completely separate payload shape from the tenant
 * JwtPayload (auth/jwt.strategy.ts) - no organizationId, no role, no
 * branchId. A platform admin isn't a member of any organization, so
 * there's nothing tenant-shaped to put here.
 */
export interface PlatformAdminJwtPayload {
  sub: string; // PlatformAdmin id
  scope: 'platform-admin';
}

/**
 * Registered under the Passport strategy name 'platform-admin-jwt', not
 * the default 'jwt' the tenant-facing JwtStrategy uses - so a tenant
 * token and a platform-admin token are structurally unable to
 * authenticate each other's routes, even before considering that they're
 * signed with different secrets (PLATFORM_ADMIN_JWT_SECRET vs
 * JWT_SECRET). PlatformAdminAuthGuard is the only guard that ever invokes
 * this strategy - no tenant-facing controller references it.
 */
@Injectable()
export class PlatformAdminJwtStrategy extends PassportStrategy(
  Strategy,
  'platform-admin-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('PLATFORM_ADMIN_JWT_SECRET'),
    });
  }

  validate(payload: PlatformAdminJwtPayload) {
    return { platformAdminId: payload.sub };
  }
}
