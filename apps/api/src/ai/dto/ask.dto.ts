import { IsString, Length } from 'class-validator';

export class AskDto {
  @IsString()
  @Length(3, 500, { message: 'Ask a question of 3 to 500 characters' })
  question!: string;
}
