import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { TaxClassesController } from './tax-classes.controller';
import { TaxClassesService } from './tax-classes.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductVariantsService } from './product-variants.service';

@Module({
  controllers: [CategoriesController, TaxClassesController, ProductsController],
  providers: [
    CategoriesService,
    TaxClassesService,
    ProductsService,
    ProductVariantsService,
  ],
})
export class CatalogModule {}
