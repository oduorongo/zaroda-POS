-- CreateEnum
CREATE TYPE "QuantityMode" AS ENUM ('COUNT', 'WEIGHT');

-- AlterTable
ALTER TABLE "batches" ALTER COLUMN "quantityReceived" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "inventory_items" ALTER COLUMN "quantity" SET DEFAULT 0,
ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3),
ALTER COLUMN "lowStockThreshold" SET DEFAULT 0,
ALTER COLUMN "lowStockThreshold" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "inventory_transactions" ALTER COLUMN "quantityDelta" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "layaway_line_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "low_stock_alerts" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3),
ALTER COLUMN "threshold" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "quantityMode" "QuantityMode" NOT NULL DEFAULT 'COUNT';

-- AlterTable
ALTER TABLE "purchase_order_line_items" ALTER COLUMN "quantityOrdered" SET DATA TYPE DECIMAL(14,3),
ALTER COLUMN "quantityReceived" SET DEFAULT 0,
ALTER COLUMN "quantityReceived" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "repackagings" ALTER COLUMN "fromQuantity" SET DATA TYPE DECIMAL(14,3),
ALTER COLUMN "toQuantity" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "sale_line_items" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "stock_take_lines" ALTER COLUMN "systemQuantity" SET DATA TYPE DECIMAL(14,3),
ALTER COLUMN "countedQuantity" SET DATA TYPE DECIMAL(14,3),
ALTER COLUMN "variance" SET DATA TYPE DECIMAL(14,3);

-- AlterTable
ALTER TABLE "stock_transfers" ALTER COLUMN "quantity" SET DATA TYPE DECIMAL(14,3);
