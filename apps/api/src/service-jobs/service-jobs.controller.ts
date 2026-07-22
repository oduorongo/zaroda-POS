import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ServiceJobStatus } from '@prisma/client';
import { ServiceJobsService } from './service-jobs.service';
import { ServiceJobsSalesService } from './service-jobs-sales.service';
import { CreateServiceJobDto } from './dto/create-service-job.dto';
import { UpdateServiceJobStatusDto } from './dto/update-service-job-status.dto';
import { InvoiceServiceJobDto } from './dto/invoice-service-job.dto';

// No @Roles() - managing/invoicing a job is a routine front-desk
// operation, same tier as core sales or the salon module's appointments.
@Controller('service-jobs')
export class ServiceJobsController {
  constructor(
    private readonly serviceJobs: ServiceJobsService,
    private readonly serviceJobsSales: ServiceJobsSalesService,
  ) {}

  @Post()
  create(@Body() dto: CreateServiceJobDto) {
    return this.serviceJobs.create(dto);
  }

  @Get()
  findAll(
    @Query('branchId') branchId?: string,
    @Query('status') status?: ServiceJobStatus,
  ) {
    return this.serviceJobs.findAll({ branchId, status });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceJobs.findOne(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateServiceJobStatusDto) {
    return this.serviceJobs.updateStatus(id, dto);
  }

  @Post(':id/invoice')
  invoice(@Param('id') id: string, @Body() dto: InvoiceServiceJobDto) {
    return this.serviceJobsSales.invoice(id, dto);
  }
}
