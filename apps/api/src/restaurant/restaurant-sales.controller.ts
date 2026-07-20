import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { RestaurantSalesService } from './restaurant-sales.service';
import { CreateTableSaleDto } from './dto/create-table-sale.dto';

// No @Roles() - ringing up a table's order is the register itself, same
// tier as core POST /sales and the plain retail checkout flow; any
// authenticated cashier/server needs it.
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
