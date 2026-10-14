import { IsInt, IsString, MaxLength, Min } from 'class-validator';

// Allowed types and max size are checked in ProductImagesService so the
// error message can say what IS allowed.
export class RequestProductImageUploadDto {
  @IsString()
  @MaxLength(50)
  contentType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

export class ConfirmProductImageDto {
  @IsString()
  @MaxLength(300)
  key!: string;
}
