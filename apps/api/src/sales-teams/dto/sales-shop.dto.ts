import { IsUUID } from 'class-validator';

/** The platform admin giving a shop to a team and the member who signed it (the only way it can change after sign-up). */
export class AssignShopDto {
  @IsUUID()
  teamId!: string;

  @IsUUID()
  agentId!: string;
}
