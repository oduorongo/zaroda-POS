import { Controller, Get } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';

// JwtAuthGuard is global. No role restriction - a terminal (any cashier)
// needs its own org's industryType to know which vertical UI to show
// (restaurant tables/KDS, pharmacy prescriptions, salon booking), same
// tier of "routine, non-sensitive lookup" as reading the product catalog.
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('me')
  findMine() {
    return this.organizations.findMine();
  }
}
