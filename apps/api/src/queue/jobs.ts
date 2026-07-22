export const NOTIFICATIONS_QUEUE = 'notifications';

export const SEND_SMS_JOB = 'send-sms';

/**
 * Every job payload in this codebase carries organizationId explicitly,
 * even when (like this one) the job itself never touches a tenant-scoped
 * table - the contract is the same regardless of what a given job needs,
 * so a future job that DOES need tenant-scoped DB access already has what
 * it requires without the payload shape needing to change. A handler that
 * does need the database must establish tenant context itself before
 * touching it (the same `set_config('app.current_tenant', ...)` pattern
 * AuthService.pinLogin/register already use, since there's no HTTP
 * request/JWT here for TenantContextInterceptor to have populated) -
 * never trust RLS to be "on" by default outside that.
 */
export interface SendSmsJobPayload {
  organizationId: string;
  to: string;
  message: string;
}
