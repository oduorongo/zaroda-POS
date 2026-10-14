import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * Rider identity - a fourth, separate token kind alongside staff, platform admin and buyer.
 * It is signed with the buyer secret but carries scope 'rider', and every strategy checks its
 * own scope, so a rider token can't pass as a buyer's (or the reverse), and neither can pass as
 * staff or admin (different secrets). Rider routes are @Public() (skipping the staff guard) and
 * apply RiderAuthGuard explicitly - the same pattern as buyers.
 */
export interface RiderJwtPayload {
  sub: string; // Rider id
  scope: 'rider';
}

@Injectable()
export class RiderJwtStrategy extends PassportStrategy(Strategy, 'rider-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('BUYER_JWT_SECRET'),
    });
  }

  validate(payload: RiderJwtPayload) {
    if (payload.scope !== 'rider') return false;
    return { riderId: payload.sub };
  }
}

@Injectable()
export class RiderAuthGuard extends AuthGuard('rider-jwt') {}

/** The verified rider id from RiderAuthGuard. */
export const CurrentRiderId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ user: { riderId: string } }>();
  return request.user.riderId;
});
