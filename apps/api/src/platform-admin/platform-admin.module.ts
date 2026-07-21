import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PlatformAdminController } from './platform-admin.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformAuditLogService } from './platform-audit-log.service';
import { PlatformAdminJwtStrategy } from './platform-admin-jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // A second, independent JwtModule registration (separate from
    // AuthModule's) - its own secret (PLATFORM_ADMIN_JWT_SECRET), its
    // own JwtService instance. Deliberately not sharing JWT_SECRET with
    // tenant tokens - see PlatformAdminJwtStrategy's comment.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('PLATFORM_ADMIN_JWT_SECRET'),
        signOptions: {
          expiresIn:
            config.get<string>('PLATFORM_ADMIN_JWT_EXPIRES_IN') ?? '4h',
        },
      }),
    }),
  ],
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminAuthService,
    PlatformAdminService,
    PlatformAuditLogService,
    PlatformAdminJwtStrategy,
  ],
})
export class PlatformAdminModule {}
