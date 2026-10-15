import { needsDeviceSubscription } from './subscriptions.util';

describe('needsDeviceSubscription', () => {
  it('gives shops, restaurants, pharmacies and salons the device subscription', () => {
    for (const type of ['RETAIL', 'RESTAURANT', 'PHARMACY', 'SALON']) expect(needsDeviceSubscription(type)).toBe(true);
  });

  it('does not give a rental landlord one, because their plan is the rental plan', () => {
    expect(needsDeviceSubscription('RENTAL')).toBe(false);
  });
});
