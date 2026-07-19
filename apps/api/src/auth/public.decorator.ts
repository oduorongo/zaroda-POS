import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/** Marks a route as not requiring a JWT - JwtAuthGuard is global (see app.module.ts), so login itself needs this. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
