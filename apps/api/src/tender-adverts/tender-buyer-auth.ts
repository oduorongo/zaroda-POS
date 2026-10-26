import {
  createParamDecorator,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * A school's identity on the tender board - one more token kind beside staff, platform admin, shopper, rider, school
 * portal and rental tenant. Signed with the buyer secret but carrying scope 'tender-buyer', and every strategy checks
 * its own scope, so this token cannot pass as anyone else's (or the reverse).
 */
export interface TenderBuyerJwtPayload {
  sub: string; // the school's id
  scope: 'tender-buyer';
}

export interface TenderBuyerIdentity {
  buyerId: string;
}

@Injectable()
export class TenderBuyerJwtStrategy extends PassportStrategy(
  Strategy,
  'tender-buyer-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('BUYER_JWT_SECRET'),
    });
  }

  validate(payload: TenderBuyerJwtPayload): TenderBuyerIdentity | false {
    if (payload.scope !== 'tender-buyer' || typeof payload.sub !== 'string')
      return false;
    return { buyerId: payload.sub };
  }
}

@Injectable()
export class TenderBuyerAuthGuard extends AuthGuard('tender-buyer-jwt') {}

export const CurrentTenderBuyer = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): TenderBuyerIdentity => {
    return ctx
      .switchToHttp()
      .getRequest<{ user: TenderBuyerIdentity }>().user;
  },
);
