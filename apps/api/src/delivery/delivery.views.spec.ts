import { toBuyerJobView, toBusinessJobView } from './delivery.service';

const rider = { id: 'rider-1', fullName: 'Juma Otieno', phone: '254712000111', vehicleType: 'BODA', plateNumber: 'KMFA 123A' };
const quote = (over: Record<string, unknown> = {}) => ({ id: 'quote-1', jobId: 'job-1', riderId: 'rider-1', fee: 150, etaMinutes: 15, note: null, status: 'OFFERED', rider, ...over });
const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  orderId: 'order-1',
  status: 'OPEN',
  audience: 'EVERYONE',
  targetRiderId: null,
  quoteDeadline: new Date(Date.now() + 600_000),
  createdAt: new Date(),
  agreedFee: null,
  assignedAt: null,
  pickedUpAt: null,
  deliveredAt: null,
  cashCollected: null,
  cancelReason: null,
  codeAttempts: 0,
  riderId: null,
  rider: null,
  quotes: [quote()],
  ...over,
});

describe('delivery views', () => {
  it('a quote keeps its OWN id (the id the buyer sends back to accept it), with the rider\'s id kept separately', () => {
    const buyer = toBuyerJobView(job() as never, '1234');
    expect(buyer.quotes[0]).toMatchObject({ id: 'quote-1', riderId: 'rider-1', fee: 150 });
    const business = toBusinessJobView(job() as never);
    expect(business.quotes[0]).toMatchObject({ id: 'quote-1', riderId: 'rider-1', fee: 150 });
  });

  it('the buyer sees the code and the rider\'s phone only once a rider is chosen, and not after delivery', () => {
    expect(toBuyerJobView(job() as never, '1234')).toMatchObject({ deliveryCode: null, rider: null });
    const assigned = job({ status: 'ASSIGNED', riderId: 'rider-1', rider, agreedFee: 150, quotes: [quote({ status: 'ACCEPTED' })] });
    expect(toBuyerJobView(assigned as never, '1234')).toMatchObject({ deliveryCode: '1234', agreedFee: 150, rider: { phone: '254712000111' } });
    expect(toBuyerJobView({ ...assigned, status: 'DELIVERED' } as never, '1234').deliveryCode).toBeNull();
  });

  it('while open the buyer sees only live offers; once chosen, only the accepted one', () => {
    const open = job({ quotes: [quote(), quote({ id: 'quote-2', status: 'WITHDRAWN' }), quote({ id: 'quote-3', status: 'REJECTED' })] });
    expect(toBuyerJobView(open as never, '1234').quotes.map((q) => q.id)).toEqual(['quote-1']);
    const assigned = job({ status: 'ASSIGNED', rider, quotes: [quote({ status: 'REJECTED', id: 'quote-2' }), quote({ status: 'ACCEPTED' })] });
    expect(toBuyerJobView(assigned as never, '1234').quotes.map((q) => q.id)).toEqual(['quote-1']);
  });

  it('the business never gets the delivery code, and sees the rider\'s phone only once one is chosen', () => {
    const open = toBusinessJobView(job({ rider }) as never);
    expect(open.rider).toBeNull();
    expect('deliveryCode' in open).toBe(false);
    const assigned = toBusinessJobView(job({ status: 'ASSIGNED', rider }) as never);
    expect(assigned.rider).toMatchObject({ riderId: 'rider-1', phone: '254712000111' });
  });

  it('an open job past its deadline reads as expired', () => {
    expect(toBuyerJobView(job({ quoteDeadline: new Date(Date.now() - 1000) }) as never, '1234').status).toBe('EXPIRED');
    expect(toBusinessJobView(job({ quoteDeadline: new Date(Date.now() - 1000) }) as never).status).toBe('EXPIRED');
  });
});
