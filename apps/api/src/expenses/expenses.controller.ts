import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CreateExpenseDto, ListExpensesQueryDto, UpdateExpenseDto } from './dto/expense.dto';
import { ExpensesService } from './expenses.service';

/** Owners and managers record and correct expenses; auditors can read them. */
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get('categories')
  categories() {
    return this.expenses.categories();
  }

  @Roles(Role.MANAGER, Role.OWNER, Role.AUDITOR)
  @Get()
  list(@Query() query: ListExpensesQueryDto) {
    return this.expenses.list(query);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Post()
  create(@Body() dto: CreateExpenseDto) {
    return this.expenses.create(dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) {
    return this.expenses.update(id, dto);
  }

  @Roles(Role.MANAGER, Role.OWNER)
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.remove(id);
  }
}
