-- School supplier: an order may be delivered in several drops. Each drop (SchoolDelivery) has its own delivery note and its own
-- invoice; an invoice is also recorded as an ordinary sale (saleId) so it appears in Sales and the reports.
-- Existing delivered orders each get one delivery (made from what the order recorded), and any that were delivered short are
-- re-opened as partly delivered so the balance can still be delivered.

ALTER TABLE "school_orders" ADD COLUMN "balanceClosedAt" TIMESTAMP(3),
ADD COLUMN "balanceClosedNote" TEXT;

-- CreateTable
CREATE TABLE "school_deliveries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "deliveryNoteNumber" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "branchId" TEXT,
    "receivedByName" TEXT NOT NULL,
    "notes" TEXT,
    "deliveredById" TEXT,
    "schoolConfirmedAt" TIMESTAMP(3),
    "schoolConfirmedBy" TEXT,
    "schoolConfirmNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "school_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_delivery_lines" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "school_delivery_lines_pkey" PRIMARY KEY ("id")
);

-- An order can now have several invoices (one per delivery)
DROP INDEX "supplier_invoices_orderId_key";

ALTER TABLE "supplier_invoices" ADD COLUMN "deliveryId" TEXT,
ADD COLUMN "saleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "school_deliveries_deliveryNoteNumber_key" ON "school_deliveries"("deliveryNoteNumber");

-- CreateIndex
CREATE INDEX "school_deliveries_organizationId_idx" ON "school_deliveries"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "school_deliveries_orderId_sequence_key" ON "school_deliveries"("orderId", "sequence");

-- CreateIndex
CREATE INDEX "school_delivery_lines_deliveryId_idx" ON "school_delivery_lines"("deliveryId");

-- CreateIndex
CREATE INDEX "school_delivery_lines_orderLineId_idx" ON "school_delivery_lines"("orderLineId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_deliveryId_key" ON "supplier_invoices"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_saleId_key" ON "supplier_invoices"("saleId");

-- CreateIndex
CREATE INDEX "supplier_invoices_orderId_idx" ON "supplier_invoices"("orderId");

-- AddForeignKey
ALTER TABLE "school_deliveries" ADD CONSTRAINT "school_deliveries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_deliveries" ADD CONSTRAINT "school_deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "school_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_delivery_lines" ADD CONSTRAINT "school_delivery_lines_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "school_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_delivery_lines" ADD CONSTRAINT "school_delivery_lines_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "school_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "school_deliveries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing delivered orders: one delivery each, from what the order recorded
INSERT INTO "school_deliveries" ("id", "organizationId", "orderId", "sequence", "deliveryNoteNumber", "deliveredAt", "receivedByName", "notes", "deliveredById", "createdAt")
SELECT gen_random_uuid()::text, o."organizationId", o."id", 1, o."deliveryNoteNumber", COALESCE(o."deliveredAt", o."updatedAt"), COALESCE(o."receivedByName", '-'), o."deliveryNotes", o."deliveredById", COALESCE(o."deliveredAt", o."updatedAt")
FROM "school_orders" o
WHERE o."deliveryNoteNumber" IS NOT NULL;

INSERT INTO "school_delivery_lines" ("id", "deliveryId", "orderLineId", "quantity")
SELECT gen_random_uuid()::text, d."id", l."id", l."quantityDelivered"
FROM "school_deliveries" d
JOIN "school_order_lines" l ON l."orderId" = d."orderId"
WHERE COALESCE(l."quantityDelivered", 0) > 0;

UPDATE "supplier_invoices" i
SET "deliveryId" = d."id"
FROM "school_deliveries" d
WHERE i."orderId" = d."orderId" AND d."sequence" = 1;

-- Delivered short: re-open, so the balance can still be delivered (or the order closed with the balance dropped)
UPDATE "school_orders" o
SET "status" = 'PARTIALLY_DELIVERED'
WHERE o."status" = 'DELIVERED'
  AND EXISTS (
    SELECT 1 FROM "school_order_lines" l
    WHERE l."orderId" = o."id" AND COALESCE(l."quantityDelivered", 0) < COALESCE(l."quantityConfirmed", l."quantityOrdered")
  );
