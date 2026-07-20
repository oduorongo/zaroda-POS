import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { PharmacyProductFlagsService } from './pharmacy-product-flags.service';
import { SetProductFlagDto } from './dto/set-product-flag.dto';

@Controller('pharmacy/products')
export class PharmacyProductsController {
  constructor(private readonly flags: PharmacyProductFlagsService) {}

  // Flagging a product as a controlled substance is a catalog-level
  // policy change, same tier as adding/removing a kitchen station or a
  // restaurant table - routine floor operations don't touch it.
  @Roles(Role.SUPERVISOR, Role.MANAGER, Role.OWNER)
  @Patch(':productId/controlled-substance')
  setFlag(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: SetProductFlagDto,
  ) {
    return this.flags.setFlag(productId, dto);
  }

  @Get(':productId/controlled-substance')
  findOne(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.flags.findOne(productId);
  }
}
