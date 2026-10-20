// The shopper's convenience fee: a percentage added to the items in the cart at checkout, rounded to the nearest whole
// shilling (M-Pesa only moves whole shillings). The shop collects it with the payment and sends it to Zaroda at the end of
// the day (see CommissionService.settleFees). It replaces the commission shops used to pay on online pickup and delivery
// orders. Table orders, hotel bookings and rentals are not charged this way.

/** The fee, in whole shillings, on a cart worth `subtotal`. */
export function convenienceFeeFor(subtotal: number, rate: number): number {
  if (!(subtotal > 0) || !(rate > 0)) return 0;
  return Math.round(subtotal * rate);
}

/** What the shopper pays in total: the items rounded up to a whole shilling, plus the fee. */
export function totalWithFee(subtotal: number, rate: number): { fee: number; amountDue: number } {
  const fee = convenienceFeeFor(subtotal, rate);
  return { fee, amountDue: Math.ceil(subtotal) + fee };
}
