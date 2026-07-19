/**
 * Provider-agnostic payment abstraction (DESIGN.md §1/§7) - card data (were
 * a card processor added later) and M-Pesa credentials never need to touch
 * sale logic; SalesService only ever talks to this interface.
 */
export interface PaymentInitiationResult {
  /** True for payment methods that settle synchronously (cash); false for STK push, which the customer must approve on their phone before it settles. */
  settledImmediately: boolean;
  providerReference?: string;
}

export interface PaymentProcessor {
  initiate(input: {
    amountKes: number;
    reference: string;
    phoneNumber?: string;
  }): Promise<PaymentInitiationResult>;
}
