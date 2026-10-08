import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { TaxClassesController } from './tax-classes.controller';
import { TaxClassesService } from './tax-classes.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductVariantsService } from './product-variants.service';
import { ProductImagesService } from './product-images.service';
import { ObjectStorageService } from '../common/storage/object-storage.service';

@Module({
  controllers: [CategoriesController, TaxClassesController, ProductsController],
  providers: [
    CategoriesService,
    TaxClassesService,
    ProductsService,
    ProductVariantsService,
    ProductImagesService,
    ObjectStorageService,
  ],
})
export class CatalogModule {}
