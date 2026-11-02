-- VAT included in supplier bills and expenses (input VAT for the VAT return). Existing rows: 0.

-- AlterTable
ALTER TABLE "supplier_bills" ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
