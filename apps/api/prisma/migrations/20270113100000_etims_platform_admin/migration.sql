ALTER TABLE "etims_settings" ADD COLUMN "liveApprovedAt" TIMESTAMP(3), ADD COLUMN "liveApprovedBy" TEXT;

CREATE TABLE "etims_gateways" (
    "environment" "EtimsEnvironment" NOT NULL,
    "consumerKey" TEXT,
    "consumerSecretEnc" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "lastTestMessage" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "etims_gateways_pkey" PRIMARY KEY ("environment")
);
