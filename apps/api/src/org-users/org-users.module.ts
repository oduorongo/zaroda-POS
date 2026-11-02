import { Module } from '@nestjs/common';
import { OrgUsersController } from './org-users.controller';
import { OrgUsersService } from './org-users.service';

@Module({
  controllers: [OrgUsersController],
  providers: [OrgUsersService],
  // Construction adds staff through the same code (construction/construction.service.ts).
  exports: [OrgUsersService],
})
export class OrgUsersModule {}
