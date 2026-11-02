import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { ReportFiltersDto } from './report-filters.dto';

export class MenuEngineeringQueryDto extends ReportFiltersDto {
  /** Compare dishes within one category (starters with starters, drinks with drinks). */
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  /** "1" = only items made from a recipe (dishes), leaving out drinks and other resold items. */
  @IsIn(['0', '1'])
  @IsOptional()
  recipesOnly?: '0' | '1';
}
