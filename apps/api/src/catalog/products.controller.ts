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
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { ProductsService } from './products.service';
import { ProductVariantsService } from './product-variants.service';
import { ProductImagesService } from './product-images.service';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import {
  CreateProductVariantDto,
  UpdateProductVariantDto,
} from './dto/product-variant.dto';
import {
  ConfirmProductImageDto,
  RequestProductImageUploadDto,
} from './dto/product-image.dto';

// Each upload URL is a signed grant to write to the bucket - generous for
// a manager adding photos, tight enough to stop a script filling storage.
const UPLOAD_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

@Controller('products')
export class ProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly variants: ProductVariantsService,
    private readonly images: ProductImagesService,
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

  // ── Online shop photos (nested under a product) ───────────────────────
  // Manager/owner only, including the read - photos are managed from the
  // back office; the terminal never needs them.

  @Roles(Role.MANAGER, Role.OWNER)
  @Get(':productId/images')
  listImages(@Param('productId', ParseUUIDPipe) productId: string) {
    return this.images.list(productId);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Throttle(UPLOAD_THROTTLE)
  @Post(':productId/images/upload-url')
  requestImageUpload(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: RequestProductImageUploadDto,
  ) {
    return this.images.requestUpload(productId, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post(':productId/images')
  confirmImage(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: ConfirmProductImageDto,
  ) {
    return this.images.confirm(productId, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post(':productId/images/:imageId/cover')
  makeImageCover(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    return this.images.makeCover(productId, imageId);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete(':productId/images/:imageId')
  @HttpCode(204)
  async removeImage(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('imageId', ParseUUIDPipe) imageId: string,
  ) {
    await this.images.remove(productId, imageId);
  }
}
