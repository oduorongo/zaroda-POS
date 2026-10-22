import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { MAX_IMPORT_ROWS } from '../catalog-import.util';

export class ImportProductsDto {
  /** The branch that holds the opening stock. Needed only when some row has opening stock. */
  @IsUUID()
  @IsOptional()
  branchId?: string;

  /** True = only check the file and say what would happen; nothing is saved. */
  @IsBoolean()
  @IsOptional()
  dryRun?: boolean;

  /** The rows of the file, as the browser read them: one object per row, keyed by column name. */
  @IsArray()
  @ArrayMaxSize(MAX_IMPORT_ROWS)
  rows!: Record<string, unknown>[];
}
