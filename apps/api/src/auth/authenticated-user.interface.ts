import { Role } from '@prisma/client';

/** Shape of req.user after JwtStrategy.validate() — one org membership per token (see JWT payload note in jwt.strategy.ts). */
export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  orgUserId: string;
  role: Role;
  branchId: string | null;
}
