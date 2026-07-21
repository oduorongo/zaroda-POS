import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma/prisma.service';
import { PlatformAdminLoginDto } from './dto/platform-admin-login.dto';
import { PlatformAdminJwtPayload } from './platform-admin-jwt.strategy';

/**
 * Deliberately no self-registration endpoint, unlike AuthService.register
 * for tenants - a public "become a platform admin" endpoint would be a
 * severe vulnerability (this identity can see every tenant). The only way
 * a PlatformAdmin row is ever created is scripts/seed-platform-admin.mjs,
 * run manually against the database directly, never over HTTP.
 */
@Injectable()
export class PlatformAdminAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: PlatformAdminLoginDto) {
    const admin = await this.prisma.platformAdmin.findUnique({
      where: { email: dto.email },
    });
    if (!admin || !(await bcrypt.compare(dto.password, admin.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: PlatformAdminJwtPayload = {
      sub: admin.id,
      scope: 'platform-admin',
    };
    return { accessToken: this.jwt.sign(payload) };
  }
}
