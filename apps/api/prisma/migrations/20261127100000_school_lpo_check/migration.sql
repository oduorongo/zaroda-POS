-- School supplier: the school's LPO (purchase order) was received and checked against its signed copy: who, and when. Additive only.
ALTER TABLE "school_orders" ADD COLUMN "lpoVerifiedAt" TIMESTAMP(3),
ADD COLUMN "lpoVerifiedByName" TEXT;
