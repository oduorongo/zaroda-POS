import { Controller, Get } from '@nestjs/common';
import { OrgUsersService } from './org-users.service';

// JwtAuthGuard is global (see app.module.ts) - any authenticated role can
// list org users (needed for the terminal's cashier picker). No @Roles(),
// deliberately: a cashier switching PIN needs to see the same list a
// manager would.
@Controller('org-users')
export class OrgUsersController {
  constructor(private readonly orgUsers: OrgUsersService) {}

  @Get()
  findAll() {
    return this.orgUsers.findAll();
  }
}
