import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * Buyer (online shopper) identity - a third, fully separate JWT alongside
 * tenant staff (auth/jwt.strategy.ts) and platform admins: its own secret
 * (BUYER_JWT_SECRET), its own Passport strategy name and payload shape.
 * A staff or admin token can't authenticate a buyer route, or vice versa.
 *
 * Buyer routes are @Public() (skipping the global staff JwtAuthGuard) and
 * apply BuyerAuthGuard explicitly - same pattern as PlatformAdminAuthGuard.
 */
export interface BuyerJwtPayload {
  sub: string; // Buyer id
  scope: 'buyer';
}

@Injectable()
export class BuyerJwtStrategy extends PassportStrategy(Strategy, 'buyer-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('BUYER_JWT_SECRET'),
    });
  }

  validate(payload: BuyerJwtPayload) {
    if (payload.scope !== 'buyer') return false;
    return { buyerId: payload.sub };
  }
}

@Injectable()
export class BuyerAuthGuard extends AuthGuard('buyer-jwt') {}

/** The verified buyer id from BuyerAuthGuard. */
export const CurrentBuyerId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<{ user: { buyerId: string } }>();
  return request.user.buyerId;
});
