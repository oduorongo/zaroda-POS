import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { SalesAgentJwtStrategy } from './sales-agent-auth';
import { SalesAgentService } from './sales-agent.service';
import { SalesAgentController, SalesAgentsAdminController, SalesTeamsAdminController } from './sales-teams.controller';
import { SalesTeamsService } from './sales-teams.service';

@Module({
  imports: [
    PassportModule,
    // Same secret as shoppers and riders, told apart by the scope claim (see sales-agent-auth.ts). A working day, not a month:
    // these accounts see other people's businesses.
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('BUYER_JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('SALES_AGENT_JWT_EXPIRES_IN') ?? '12h' },
      }),
    }),
  ],
  controllers: [SalesTeamsAdminController, SalesAgentsAdminController, SalesAgentController],
  providers: [SalesAgentJwtStrategy, SalesAgentService, SalesTeamsService],
  exports: [SalesTeamsService],
})
export class SalesTeamsModule {}
