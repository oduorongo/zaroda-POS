-- CreateTable
CREATE TABLE "rental_caretaker_properties" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rental_caretaker_properties_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rental_caretaker_properties_orgUserId_propertyId_key" ON "rental_caretaker_properties"("orgUserId", "propertyId");

-- CreateIndex
CREATE INDEX "rental_caretaker_properties_organizationId_idx" ON "rental_caretaker_properties"("organizationId");

-- AddForeignKey
ALTER TABLE "rental_caretaker_properties" ADD CONSTRAINT "rental_caretaker_properties_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_caretaker_properties" ADD CONSTRAINT "rental_caretaker_properties_orgUserId_fkey" FOREIGN KEY ("orgUserId") REFERENCES "org_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_caretaker_properties" ADD CONSTRAINT "rental_caretaker_properties_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "rental_properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;
