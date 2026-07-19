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
import { TaxClassesService } from './tax-classes.service';
import { CreateTaxClassDto, UpdateTaxClassDto } from './dto/tax-class.dto';

@Controller('tax-classes')
export class TaxClassesController {
  constructor(private readonly taxClasses: TaxClassesService) {}

  @Get()
  findAll() {
    return this.taxClasses.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.taxClasses.findOne(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateTaxClassDto) {
    return this.taxClasses.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaxClassDto,
  ) {
    return this.taxClasses.update(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.taxClasses.remove(id);
  }
}
