import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

/** Money the business spends that is not stock, for the profit report. The expenses table is core (no industry manifest). */
@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
})
export class ExpensesModule {}
