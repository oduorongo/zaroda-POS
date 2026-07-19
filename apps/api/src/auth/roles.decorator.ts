import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Usage: @Roles(Role.MANAGER, Role.OWNER) above a controller method, alongside @UseGuards(JwtAuthGuard, RolesGuard). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
