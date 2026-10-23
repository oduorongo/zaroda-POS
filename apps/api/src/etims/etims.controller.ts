import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import {
  ConnectDeviceDto,
  ItemClassQueryDto,
  UpdateEtimsSettingsDto,
} from './dto/etims.dto';
import {
  ClassifyItemsDto,
  ItemListQueryDto,
  RegisterItemsDto,
  UpdateEtimsItemDto,
} from './dto/etims-items.dto';
import { DocumentListQueryDto } from './dto/etims-documents.dto';
import { EtimsCodesService } from './etims-codes.service';
import { EtimsDocumentsService } from './etims-documents.service';
import { EtimsItemsService } from './etims-items.service';
import { EtimsSettingsService } from './etims-settings.service';

// eTIMS is the business's tax setup, so it is for owners and managers; an auditor can look.
const WRITERS = [Role.MANAGER, Role.OWNER];
const READERS = [Role.MANAGER, Role.OWNER, Role.AUDITOR];

@Controller('etims')
export class EtimsController {
  constructor(
    private readonly settings: EtimsSettingsService,
    private readonly codes: EtimsCodesService,
    private readonly items: EtimsItemsService,
    private readonly documents: EtimsDocumentsService,
  ) {}

  @Roles(...READERS)
  @Get('settings')
  overview() {
    return this.settings.overview();
  }

  @Roles(...WRITERS)
  @Put('settings')
  update(@Body() dto: UpdateEtimsSettingsDto) {
    return this.settings.update(dto);
  }

  @Roles(...WRITERS)
  @Post('devices/:branchId/connect')
  @HttpCode(200)
  connect(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: ConnectDeviceDto,
  ) {
    return this.settings.connect(branchId, dto);
  }

  @Roles(...WRITERS)
  @Post('devices/:branchId/disconnect')
  @HttpCode(200)
  disconnect(@Param('branchId', ParseUUIDPipe) branchId: string) {
    return this.settings.disconnect(branchId);
  }

  @Roles(...WRITERS)
  @Post('codes/sync')
  @HttpCode(200)
  sync() {
    return this.codes.sync();
  }

  @Roles(...READERS)
  @Get('codes/summary')
  summary() {
    return this.codes.counts();
  }

  @Roles(...READERS)
  @Get('codes')
  lists(@Query('cls') cls?: string) {
    return this.codes.lists(cls);
  }

  @Roles(...READERS)
  @Get('item-classes')
  itemClasses(@Query() q: ItemClassQueryDto) {
    return this.codes.searchItemClasses(q.search, q.limit);
  }

  // ── Products as KRA knows them ──
  @Roles(...READERS)
  @Get('items')
  listItems(@Query() q: ItemListQueryDto) {
    return this.items.list(q);
  }

  @Roles(...WRITERS)
  @Put('items/:variantId')
  updateItem(
    @Param('variantId', ParseUUIDPipe) variantId: string,
    @Body() dto: UpdateEtimsItemDto,
  ) {
    return this.items.update(variantId, dto);
  }

  @Roles(...WRITERS)
  @Post('items/classify')
  @HttpCode(200)
  classify(@Body() dto: ClassifyItemsDto) {
    return this.items.classify(dto.variantIds, dto.itemClsCd);
  }

  @Roles(...WRITERS)
  @Post('items/register')
  @HttpCode(200)
  register(@Body() dto: RegisterItemsDto) {
    return this.items.register(dto);
  }

  // ── Sales, refunds and stock sent to KRA ──
  @Roles(...READERS)
  @Get('documents')
  listDocuments(@Query() q: DocumentListQueryDto) {
    return this.documents.list(q);
  }

  @Roles(...READERS)
  @Get('documents/by-sale/:saleId')
  documentsForSale(@Param('saleId', ParseUUIDPipe) saleId: string) {
    return this.documents.forSale(saleId);
  }

  /** Send what is waiting now instead of at the next timed pass. */
  @Roles(...WRITERS)
  @Post('documents/run')
  @HttpCode(200)
  runDocuments() {
    return this.documents.runPass();
  }

  @Roles(...WRITERS)
  @Post('documents/:id/retry')
  @HttpCode(200)
  retryDocument(@Param('id', ParseUUIDPipe) id: string) {
    return this.documents.retry(id);
  }
}
