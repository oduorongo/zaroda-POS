import { Module } from '@nestjs/common';
import { OrgUsersController } from './org-users.controller';
import { OrgUsersService } from './org-users.service';

@Module({
  controllers: [OrgUsersController],
  providers: [OrgUsersService],
})
export class OrgUsersModule {}
