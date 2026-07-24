import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { OrganizationsService } from './organizations.service';
import { UpdateOrganizationDto } from './dto/update-organization.dto';

// JwtAuthGuard is global. No role restriction on the GET - a terminal (any
// cashier) needs its own org's industryType to know which vertical UI to
// show (restaurant tables/KDS, pharmacy prescriptions, salon booking), same
// tier of "routine, non-sensitive lookup" as reading the product catalog.
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get('me')
  findMine() {
    return this.organizations.findMine();
  }

  // KRA PIN / VAT status is compliance-sensitive tenant configuration -
  // owner/manager only, unlike the read side above.
  @Roles(Role.MANAGER, Role.OWNER)
  @Patch('me')
  updateMine(@Body() dto: UpdateOrganizationDto) {
    return this.organizations.updateMine(dto);
  }
}
