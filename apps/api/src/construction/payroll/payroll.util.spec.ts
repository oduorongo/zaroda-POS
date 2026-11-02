import { casualDeductions, mpesaPhone, payrollRates, periodDays, payslipText } from './payroll.util';

const settings = new Map<string, { rate: number; threshold: number | null }>([
  ['NSSF', { rate: 6, threshold: 72_000 }],
  ['SHIF', { rate: 2.75, threshold: 300 }],
  ['HOUSING_LEVY', { rate: 1.5, threshold: null }],
  ['PAYE_BAND_1', { rate: 10, threshold: 24_000 }],
  ['PAYE_BAND_2', { rate: 25, threshold: 32_333 }],
  ['PAYE_BAND_3', { rate: 30, threshold: 500_000 }],
  ['PAYE_BAND_4', { rate: 32.5, threshold: 800_000 }],
  ['PAYE_BAND_5', { rate: 35, threshold: null }],
  ['PERSONAL_RELIEF', { rate: 0, threshold: 2_400 }],
]);
const rates = payrollRates(settings);

describe('construction payroll maths', () => {
  it('counts the days in a period, both ends included', () => {
    expect(periodDays('2026-10-01', '2026-10-07')).toBe(7);
    expect(periodDays('2026-10-01', '2026-10-30')).toBe(30);
  });

  it('a week of a casual on 900 a day: NSSF, SHIF and housing levy, no PAYE', () => {
    const d = casualDeductions(5400, 7, rates);
    expect(d).toEqual({ nssf: 324, shif: 148.5, housingLevy: 81, paye: 0, deductions: 553.5, net: 4846.5 });
  });

  it('over a 30-day period it matches the monthly statutory figures', () => {
    const d = casualDeductions(50_000, 30, rates);
    expect(d.nssf).toBe(3000);
    expect(d.shif).toBe(1375);
    expect(d.housingLevy).toBe(750);
    // taxable 44,875: 2,400 + 2,083.25 + 3,762.6 - 2,400 relief
    expect(d.paye).toBe(5845.85);
    expect(d.net).toBe(50_000 - 3000 - 1375 - 750 - 5845.85);
  });

  it('caps NSSF at the upper earnings limit, scaled to the period', () => {
    expect(casualDeductions(100_000, 30, rates).nssf).toBe(4320);
    expect(casualDeductions(100_000, 15, rates).nssf).toBe(2160);
  });

  it('applies the SHIF minimum, scaled to the period', () => {
    expect(casualDeductions(1000, 30, rates).shif).toBe(300);
    expect(casualDeductions(1000, 6, rates).shif).toBe(60);
  });

  it('switched-off settings deduct nothing', () => {
    const none = payrollRates(new Map());
    expect(casualDeductions(5400, 7, none)).toEqual({ nssf: 0, shif: 0, housingLevy: 0, paye: 0, deductions: 0, net: 5400 });
  });

  it('never deducts more than the pay', () => {
    const d = casualDeductions(50, 30, rates);
    expect(d.deductions).toBe(50);
    expect(d.net).toBe(0);
  });

  it('a new rate in the settings changes the deduction (nothing hard-coded)', () => {
    const raised = new Map(settings);
    raised.set('HOUSING_LEVY', { rate: 2, threshold: null });
    expect(casualDeductions(5400, 7, payrollRates(raised)).housingLevy).toBe(108);
  });

  it('turns phone numbers into M-Pesa format', () => {
    expect(mpesaPhone('0712 345 678')).toBe('254712345678');
    expect(mpesaPhone('+254 112 345 678')).toBe('254112345678');
    expect(mpesaPhone('12345')).toBeNull();
    expect(mpesaPhone(null)).toBeNull();
  });

  it('writes a short payslip text', () => {
    const d = casualDeductions(5400, 7, rates);
    expect(payslipText({ company: 'Uriri Builders', worker: 'J. Otieno', from: '2026-10-01', to: '2026-10-07', days: 6, rate: 900, gross: 5400, d, method: 'M-Pesa', reference: 'QK1' })).toBe(
      'Uriri Builders: pay for J. Otieno, 2026-10-01 to 2026-10-07. 6 days x 900 = KES 5400. Less NSSF 324, SHIF 148.5, Housing 81. Net KES 4846.5 paid by M-Pesa (QK1).',
    );
  });
});
