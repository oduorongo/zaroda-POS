-- AlterTable
ALTER TABLE "room_bookings" ADD COLUMN     "commissionInvoiceId" TEXT;

-- CreateIndex
CREATE INDEX "room_bookings_commissionInvoiceId_idx" ON "room_bookings"("commissionInvoiceId");

-- AddForeignKey
ALTER TABLE "room_bookings" ADD CONSTRAINT "room_bookings_commissionInvoiceId_fkey" FOREIGN KEY ("commissionInvoiceId") REFERENCES "commission_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
