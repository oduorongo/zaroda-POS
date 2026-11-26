-- Stock on the balance sheet: deliveries booked as received and stock kept equal to the shelves from this moment.
ALTER TABLE "ledger_settings" ADD COLUMN "stockFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
