// The chart of accounts every business starts with. Each account the system posts to automatically has a fixed key; the business
// can rename any account, add its own and switch off ones it does not use, but a keyed account always exists so automatic
// postings never fail for want of one. Codes follow the usual order: 1 assets, 2 liabilities, 3 equity, 4 income, 5-6 costs.

export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export const SYSTEM_ACCOUNTS = [
  { key: 'CASH', code: '1000', name: 'Cash on hand', type: 'ASSET' },
  { key: 'MPESA', code: '1010', name: 'M-Pesa', type: 'ASSET' },
  { key: 'BANK', code: '1020', name: 'Bank', type: 'ASSET' },
  { key: 'CARD_CLEARING', code: '1030', name: 'Card payments not yet in the bank', type: 'ASSET' },
  { key: 'AR', code: '1100', name: 'Customers who owe us (debtors)', type: 'ASSET' },
  { key: 'GUEST_AR', code: '1105', name: 'Hotel guests who owe us', type: 'ASSET' },
  { key: 'RENT_AR', code: '1110', name: 'Rent owed by tenants', type: 'ASSET' },
  { key: 'BAD_DEBT_ALLOWANCE', code: '1150', name: 'Set aside for debts that may not be paid', type: 'ASSET' },
  { key: 'WHT_RECEIVABLE', code: '1160', name: 'Withholding tax deducted by customers', type: 'ASSET' },
  { key: 'INVENTORY', code: '1200', name: 'Stock', type: 'ASSET' },
  { key: 'AP', code: '2000', name: 'Suppliers we owe (creditors)', type: 'LIABILITY' },
  { key: 'VAT_OUTPUT', code: '2100', name: 'VAT owed to KRA', type: 'LIABILITY' },
  { key: 'PAYE', code: '2110', name: 'PAYE owed to KRA', type: 'LIABILITY' },
  { key: 'NSSF', code: '2120', name: 'NSSF owed', type: 'LIABILITY' },
  { key: 'SHIF', code: '2130', name: 'SHIF owed', type: 'LIABILITY' },
  { key: 'HOUSING_LEVY', code: '2140', name: 'Housing levy owed', type: 'LIABILITY' },
  { key: 'CUSTOMER_DEPOSITS', code: '2200', name: 'Customer deposits (layaways)', type: 'LIABILITY' },
  { key: 'TENANT_DEPOSITS', code: '2210', name: 'Tenant deposits held', type: 'LIABILITY' },
  { key: 'CAPITAL', code: '3000', name: "Owner's capital", type: 'EQUITY' },
  { key: 'DRAWINGS', code: '3010', name: "Owner's drawings", type: 'EQUITY' },
  { key: 'OPENING_BALANCE', code: '3100', name: 'Opening balances', type: 'EQUITY' },
  { key: 'RETAINED_EARNINGS', code: '3200', name: 'Profit kept from earlier years', type: 'EQUITY' },
  { key: 'SALES', code: '4000', name: 'Sales', type: 'INCOME' },
  { key: 'RENT_INCOME', code: '4100', name: 'Rent received', type: 'INCOME' },
  { key: 'RENT_OTHER_INCOME', code: '4110', name: 'Other charges to tenants', type: 'INCOME' },
  { key: 'OTHER_INCOME', code: '4200', name: 'Other income', type: 'INCOME' },
  { key: 'SALES_RETURNS', code: '4900', name: 'Refunds and returns', type: 'INCOME' },
  { key: 'COGS', code: '5000', name: 'Cost of goods sold', type: 'EXPENSE' },
  { key: 'WASTE', code: '5100', name: 'Stock wasted or lost', type: 'EXPENSE' },
  { key: 'SALARIES', code: '6000', name: 'Salaries and wages', type: 'EXPENSE' },
  { key: 'EXP_RENT', code: '6010', name: 'Rent', type: 'EXPENSE' },
  { key: 'EXP_UTILITIES', code: '6020', name: 'Electricity, water and internet', type: 'EXPENSE' },
  { key: 'EXP_AIRTIME', code: '6030', name: 'Airtime and data', type: 'EXPENSE' },
  { key: 'EXP_TRANSPORT', code: '6040', name: 'Transport and fuel', type: 'EXPENSE' },
  { key: 'EXP_REPAIRS', code: '6050', name: 'Repairs and maintenance', type: 'EXPENSE' },
  { key: 'EXP_SUPPLIES', code: '6060', name: 'Supplies (packaging, cleaning, stationery)', type: 'EXPENSE' },
  { key: 'EXP_MARKETING', code: '6070', name: 'Marketing and advertising', type: 'EXPENSE' },
  { key: 'EXP_LICENCES', code: '6080', name: 'Licences, permits and taxes', type: 'EXPENSE' },
  { key: 'EXP_CHARGES', code: '6090', name: 'M-Pesa and bank charges', type: 'EXPENSE' },
  { key: 'BAD_DEBTS', code: '6100', name: 'Bad debts', type: 'EXPENSE' },
  { key: 'EXP_OTHER', code: '6900', name: 'Other expenses', type: 'EXPENSE' },
] as const satisfies readonly { key: string; code: string; name: string; type: LedgerAccountType }[];

export type AccountKey = (typeof SYSTEM_ACCOUNTS)[number]['key'];

/** Where an expense of each category is posted (Salaries recorded as an expense go with payroll). */
export function expenseAccount(category: string): AccountKey {
  if (category === 'SALARIES') return 'SALARIES';
  const key = `EXP_${category}`;
  return SYSTEM_ACCOUNTS.some((a) => a.key === key) ? (key as AccountKey) : 'EXP_OTHER';
}

/** The side an account's balance normally sits on: assets and costs are debits, the rest credits. */
export const isDebitNormal = (type: LedgerAccountType) => type === 'ASSET' || type === 'EXPENSE';
