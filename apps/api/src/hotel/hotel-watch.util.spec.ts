import { WATCH_MIN_PAID_BOOKINGS, percent, watchReason } from './hotel-watch.util';

describe('watchReason', () => {
  it('says nothing about a hotel with too few bookings to judge', () => {
    expect(watchReason({ paid: WATCH_MIN_PAID_BOOKINGS - 1, noShow: 4, cancelled: 0 })).toBeNull();
    expect(watchReason({ paid: 0, noShow: 0, cancelled: 0 })).toBeNull();
  });

  it('flags a hotel where 30% or more of paid bookings end as no-shows or cancellations', () => {
    const reason = watchReason({ paid: 10, noShow: 2, cancelled: 1 });
    expect(reason).toMatch(/3 of 10 paid bookings \(30%\)/);
    expect(reason).toMatch(/no-show \(2\)/);
    expect(reason).toMatch(/cancellation \(1\)/);
  });

  it('leaves a hotel with an ordinary share alone', () => {
    expect(watchReason({ paid: 10, noShow: 1, cancelled: 1 })).toBeNull();
    expect(watchReason({ paid: 20, noShow: 3, cancelled: 2 })).toBeNull();
  });

  it('counts a hotel right at the minimum number of bookings', () => {
    expect(watchReason({ paid: WATCH_MIN_PAID_BOOKINGS, noShow: 2, cancelled: 0 })).toMatch(/2 of 5/);
  });
});

describe('percent', () => {
  it('rounds and never divides by zero', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 0)).toBe(0);
  });
});
