/**
 * Provider-agnostic notification abstraction (DESIGN.md §1/§7's
 * "SMS/notifications: Africa's Talking behind a NotificationProvider
 * interface, swap providers without touching call sites" - written down
 * as intent since Phase 0, not built until now). The exact same shape
 * PaymentProcessor already established for M-Pesa: callers never import
 * a specific provider, only this interface, so provider credentials
 * (and provider outages) never leak into business logic.
 */
export interface SendSmsResult {
  /**
   * False whenever the provider isn't configured or the send failed -
   * deliberately never throws (unlike PaymentProcessor.initiate(), which
   * throws loudly if M-Pesa isn't configured, because a payment silently
   * "succeeding" without actually charging anyone would be a critical
   * bug). A notification is a best-effort nice-to-have on top of an
   * already-completed action (a booking, in the first caller) - the
   * caller's own flow must never fail or roll back just because a text
   * message didn't go out. Callers check `.sent` to decide what to tell
   * the end user, nothing more.
   */
  sent: boolean;
  providerReference?: string;
}

export interface NotificationProvider {
  sendSms(input: { to: string; message: string }): Promise<SendSmsResult>;
}
