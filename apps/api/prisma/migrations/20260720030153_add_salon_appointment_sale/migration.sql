-- CreateTable
CREATE TABLE "salon_appointment_sales" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,

    CONSTRAINT "salon_appointment_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "salon_appointment_sales_appointmentId_key" ON "salon_appointment_sales"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "salon_appointment_sales_saleId_key" ON "salon_appointment_sales"("saleId");

-- AddForeignKey
ALTER TABLE "salon_appointment_sales" ADD CONSTRAINT "salon_appointment_sales_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "salon_appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salon_appointment_sales" ADD CONSTRAINT "salon_appointment_sales_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
