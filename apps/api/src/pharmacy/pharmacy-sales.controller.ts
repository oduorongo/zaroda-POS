import { Body, Controller, Post } from '@nestjs/common';
import { PharmacySalesService } from './pharmacy-sales.service';
import { CreatePharmacySaleDto } from './dto/create-pharmacy-sale.dto';

// No @Roles() - this is the register itself, same as core POST /sales;
// the controlled-substance/prescription check is a business rule inside
// the service, not a role gate on who can use the endpoint.
@Controller('pharmacy/sales')
export class PharmacySalesController {
  constructor(private readonly pharmacySales: PharmacySalesService) {}

  @Post()
  create(@Body() dto: CreatePharmacySaleDto) {
    return this.pharmacySales.createWithPrescription(dto);
  }
}
