import { BadRequestException } from '@nestjs/common';
import { guestPhone, maskId } from './front-desk.service';
import { roomChargeReference } from './folio.util';
import { RoomChargeService } from './room-charge.service';

const BOOKING = '11111111-1111-4111-8111-111111111111';

function setup(
  booking: { id: string; status: string; guestName: string } | null,
  existingEntries: { saleId: string }[] = [],
) {
  const tx = {
    roomBooking: { findUnique: jest.fn().mockResolvedValue(booking) },
    hotelFolioEntry: { create: jest.fn() },
  };
  const tenantPrisma = {
    run: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const folios = {
    loadBooking: jest.fn().mockResolvedValue(booking),
    ensureFolio: jest
      .fn()
      .mockResolvedValue({ id: 'folio-1', entries: existingEntries }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    service: new RoomChargeService(tenantPrisma as any, folios as any),
    tx,
  };
}

describe('RoomChargeService.verify', () => {
  it('says yes only for a guest who is checked in', async () => {
    const { service } = setup({
      id: BOOKING,
      status: 'CHECKED_IN',
      guestName: 'Amina',
    });
    await expect(
      service.verify({
        providerReference: roomChargeReference(BOOKING, 'sale-1'),
        amount: 300,
      }),
    ).resolves.toBe(true);
  });

  it('refuses a guest who is not checked in, with who it is', async () => {
    for (const status of ['CONFIRMED', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW']) {
      const { service } = setup({ id: BOOKING, status, guestName: 'Amina' });
      await expect(
        service.verify({
          providerReference: roomChargeReference(BOOKING, 'sale-1'),
          amount: 300,
        }),
      ).rejects.toThrow(/Amina is not checked in/);
    }
  });

  it('refuses a booking that does not exist, and says no to anything that is not a room reference', async () => {
    await expect(
      setup(null).service.verify({
        providerReference: roomChargeReference(BOOKING, 'sale-1'),
        amount: 300,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      setup(null).service.verify({
        providerReference: 'something-else',
        amount: 300,
      }),
    ).resolves.toBe(false);
  });
});

describe('RoomChargeService.post', () => {
  const sale = (over = {}) => ({
    id: 'sale-1',
    cashierOrgUserId: 'staff-1',
    payments: [
      {
        method: 'ROOM_CHARGE',
        amount: 300,
        providerReference: roomChargeReference(BOOKING, 'sale-1'),
      },
    ],
    ...over,
  });
  const booking = { id: BOOKING, status: 'CHECKED_IN', guestName: 'Amina' };

  it('adds the charge to the folio, linked to the sale', async () => {
    const { service, tx } = setup(booking);
    await service.post(sale());
    expect(tx.hotelFolioEntry.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        folioId: 'folio-1',
        type: 'CHARGE',
        amount: 300,
        saleId: 'sale-1',
        createdById: 'staff-1',
      }),
    });
  });

  it('does not add the same sale twice', async () => {
    const { service, tx } = setup(booking, [{ saleId: 'sale-1' }]);
    await service.post(sale());
    expect(tx.hotelFolioEntry.create).not.toHaveBeenCalled();
  });

  it("ignores sales with no room charge, and the settlement sale's own room payment", async () => {
    const { service, tx } = setup(booking);
    await service.post(
      sale({
        payments: [{ method: 'CASH', amount: 300, providerReference: null }],
      }),
    );
    await service.post(
      sale({
        payments: [
          {
            method: 'ROOM_CHARGE',
            amount: 300,
            providerReference: `SETTLE:${BOOKING}`,
          },
        ],
      }),
    );
    expect(tx.hotelFolioEntry.create).not.toHaveBeenCalled();
  });

  it('never throws (a lost folio step must not undo a saved sale)', async () => {
    const { service, tx } = setup(booking);
    tx.hotelFolioEntry.create.mockRejectedValue(new Error('db down'));
    await expect(service.post(sale())).resolves.toBeUndefined();
  });
});

describe('maskId', () => {
  it('shows only the last four characters', () => {
    expect(maskId('A1234567')).toBe('****4567');
    expect(maskId('12345678')).toBe('****5678');
    expect(maskId('1234')).toBe('****');
    expect(maskId('')).toBeNull();
    expect(maskId(null)).toBeNull();
  });
  it('never gives away the length of a long number', () => {
    expect(maskId('AB1234567890123456').length).toBeLessThanOrEqual(12);
  });
});

describe('guestPhone', () => {
  it("normalises a Kenyan mobile and keeps a visitor's number as typed", () => {
    expect(guestPhone('0711 222 333')).toBe('254711222333');
    expect(guestPhone('+44 7700 900123')).toBe('+447700900123');
  });
  it('refuses junk', () => {
    expect(guestPhone('12')).toBeNull();
    expect(guestPhone('abc')).toBeNull();
  });
});
