import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * A rental tenant's identity - one more token kind alongside staff, platform admin, buyer and rider. It is signed
 * with the buyer secret but carries scope 'rental-tenant', and every strategy checks its own scope, so a tenant
 * token cannot pass as a shopper's or rider's (or the reverse), and none of them can pass as staff or admin
 * (different secret). The identity is the verified email address. Tenant routes are @Public() (skipping the staff
 * guard) and apply TenantAuthGuard explicitly - the same pattern as buyers and riders.
 */
export interface RentalTenantJwtPayload {
  sub: string; // the tenant's email address, lower-case
  scope: 'rental-tenant';
}

@Injectable()
export class RentalTenantJwtStrategy extends PassportStrategy(Strategy, 'rental-tenant-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('BUYER_JWT_SECRET'),
    });
  }

  validate(payload: RentalTenantJwtPayload) {
    if (payload.scope !== 'rental-tenant' || typeof payload.sub !== 'string') return false;
    return { tenantEmail: payload.sub };
  }
}

@Injectable()
export class TenantAuthGuard extends AuthGuard('rental-tenant-jwt') {}

/** The verified email from TenantAuthGuard. */
export const CurrentTenantEmail = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ user: { tenantEmail: string } }>();
  return request.user.tenantEmail;
});
