import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';

// JwtAuthGuard and RolesGuard are both global (see app.module.ts) - every
// route here already requires a valid token; RolesGuard only has an effect
// where @Roles() is present (see roles.guard.ts), so reads with no @Roles()
// are open to any authenticated role.
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  // Reads: any authenticated role, including CASHIER - they browse the
  // catalog at the point of sale.
  @Get()
  findAll() {
    return this.categories.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.findOne(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.categories.remove(id);
  }
}
