import { createParamDecorator, ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

/**
 * A school's identity on the supplier's portal - one more token kind beside staff, platform admin, buyer, rider and rental
 * tenant. Signed with the buyer secret but carrying scope 'school', and every strategy checks its own scope, so a school
 * token cannot pass as anyone else's (or the reverse), and none can pass as staff (different secret). It names the school
 * and the business it orders from, so a school can never reach another supplier's data.
 */
export interface SchoolJwtPayload {
  sub: string; // the school's id
  org: string; // the supplier's organization id
  scope: 'school';
}

export interface SchoolIdentity {
  schoolId: string;
  organizationId: string;
}

@Injectable()
export class SchoolJwtStrategy extends PassportStrategy(Strategy, 'school-jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('BUYER_JWT_SECRET'),
    });
  }

  validate(payload: SchoolJwtPayload): SchoolIdentity | false {
    if (payload.scope !== 'school' || typeof payload.sub !== 'string' || typeof payload.org !== 'string') return false;
    return { schoolId: payload.sub, organizationId: payload.org };
  }
}

@Injectable()
export class SchoolAuthGuard extends AuthGuard('school-jwt') {}

export const CurrentSchool = createParamDecorator((_: unknown, ctx: ExecutionContext): SchoolIdentity => {
  return ctx.switchToHttp().getRequest<{ user: SchoolIdentity }>().user;
});
