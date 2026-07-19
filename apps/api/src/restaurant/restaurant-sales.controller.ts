import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RestaurantSalesService } from './restaurant-sales.service';
import { CreateTableSaleDto } from './dto/create-table-sale.dto';

@Controller('restaurant/tables')
export class RestaurantSalesController {
  constructor(private readonly restaurantSales: RestaurantSalesService) {}

  @Post(':tableId/sales')
  createSale(
    @Param('tableId', ParseUUIDPipe) tableId: string,
    @Body() dto: CreateTableSaleDto,
  ) {
    return this.restaurantSales.createForTable(tableId, dto);
  }
}
