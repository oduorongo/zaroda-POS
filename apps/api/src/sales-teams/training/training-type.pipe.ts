import { BadRequestException, PipeTransform } from '@nestjs/common';
import { TRAINING_TYPES } from './training-kits';

export class TrainingTypePipe implements PipeTransform<string, string> {
  transform(value: string) {
    const type = String(value ?? '').toUpperCase();
    if (!TRAINING_TYPES.includes(type)) throw new BadRequestException(`Business type must be one of ${TRAINING_TYPES.join(', ')}`);
    return type;
  }
}
