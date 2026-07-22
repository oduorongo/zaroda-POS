import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RecipesService } from './recipes.service';
import { SetRecipeDto } from './dto/set-recipe.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts). A
// recipe is a catalog-configuration concern, same tier as editing a
// product/variant itself - MANAGER/OWNER only to write; any authenticated
// role can read (a supervisor troubleshooting a stock conflict may need to
// see whether a variant is recipe-tracked).
@Controller('recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  @Get(':variantId')
  get(@Param('variantId', ParseUUIDPipe) variantId: string) {
    return this.recipes.get(variantId);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Put(':variantId')
  set(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: SetRecipeDto,
  ) {
    return this.recipes.set(variantId, dto);
  }
}
