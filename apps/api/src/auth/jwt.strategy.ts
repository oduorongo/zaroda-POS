import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { AuthenticatedUser } from './authenticated-user.interface';

/**
 * A JWT is scoped to exactly ONE org membership (organizationId + role),
 * not "this user across all their orgs" - a user who belongs to multiple
 * organizations picks one at login (see AuthService.login) and gets a
 * fresh token if they need to switch. This keeps RBAC checks a simple
 * "does req.user.role satisfy @Roles(...)" with no per-request org lookup.
 */
export interface JwtPayload {
  sub: string; // userId
  organizationId: string;
  orgUserId: string;
  role: Role;
  branchId: string | null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    return {
      userId: payload.sub,
      organizationId: payload.organizationId,
      orgUserId: payload.orgUserId,
      role: payload.role,
      branchId: payload.branchId,
    };
  }
}
