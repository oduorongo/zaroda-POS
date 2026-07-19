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
import { ProductsService } from './products.service';
import { ProductVariantsService } from './product-variants.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
} from './dto/product-variant.dto';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly variants: ProductVariantsService,
  ) {}

  @Get()
  findAll() {
    return this.products.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.products.findOne(id);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ) {
    return this.products.update(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.products.remove(id);
  }

  // ── Variants (nested under a product) ──────────────────────────────────

  @Get(':productId/variants')
  findAllVariants(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.variants.findAll(productId);
  }

  @Get(':productId/variants/:variantId')
  findOneVariant(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    return this.variants.findOne(productId, variantId);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post(':productId/variants')
  createVariant(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: CreateProductVariantDto,
  ) {
    return this.variants.create(productId, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':productId/variants/:variantId')
  updateVariant(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateProductVariantDto,
  ) {
    return this.variants.update(productId, variantId, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete(':productId/variants/:variantId')
  @HttpCode(204)
  async removeVariant(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('variantId', ParseUUIDPipe) variantId: string,
  ) {
    await this.variants.remove(productId, variantId);
  }
}
