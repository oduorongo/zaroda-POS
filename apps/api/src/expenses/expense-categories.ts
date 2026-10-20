// What a business can say a payment was for. A short fixed list keeps the reports readable; "Other" is there for the rest.
// Buying stock is deliberately NOT one of them: stock reaches the profit report as the cost of what was sold, so listing it
// here too would count it twice.
export const EXPENSE_CATEGORIES = [
  { key: 'RENT', label: 'Rent' },
  { key: 'UTILITIES', label: 'Electricity, water and internet' },
  { key: 'AIRTIME', label: 'Airtime and data' },
  { key: 'SALARIES', label: 'Salaries and wages (not paid through Payroll)' },
  { key: 'TRANSPORT', label: 'Transport and fuel' },
  { key: 'REPAIRS', label: 'Repairs and maintenance' },
  { key: 'SUPPLIES', label: 'Supplies (packaging, cleaning, stationery)' },
  { key: 'MARKETING', label: 'Marketing and advertising' },
  { key: 'LICENCES', label: 'Licences, permits and taxes' },
  { key: 'CHARGES', label: 'M-Pesa and bank charges' },
  { key: 'OTHER', label: 'Other' },
] as const;

export const EXPENSE_CATEGORY_KEYS: string[] = EXPENSE_CATEGORIES.map((c) => c.key);
export const PAID_WITH = ['CASH', 'MPESA', 'BANK', 'CARD'] as const;
