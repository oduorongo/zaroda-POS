-- AlterTable
ALTER TABLE "online_orders" ADD COLUMN     "tipAmount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "online_order_lines" ADD COLUMN     "note" TEXT;
