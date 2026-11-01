import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class SendMessageDto {
  /** People to send to (their staff ids). */
  @IsArray()
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  @IsOptional()
  to?: string[];

  /** Everyone in the company. */
  @IsBoolean()
  @IsOptional()
  everyone?: boolean;

  /** A project's team (everyone on the project). */
  @IsUUID()
  @IsOptional()
  projectId?: string;

  /** A reply: goes to everyone in that conversation. */
  @IsUUID()
  @IsOptional()
  replyTo?: string;

  @Transform(trim)
  @IsString()
  @MaxLength(120)
  @IsOptional()
  subject?: string;

  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Write a message' })
  @MaxLength(4000)
  body!: string;
}

export class MessageListQueryDto {
  @IsIn(['inbox', 'sent'])
  @IsOptional()
  box?: 'inbox' | 'sent';
}
