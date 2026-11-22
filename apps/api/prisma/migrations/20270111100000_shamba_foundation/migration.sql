-- Zaroda Shamba (farm management) F1: plans, subscriptions, settings, farm layout, enterprises and farm roles. docs/farm.

-- CreateEnum
CREATE TYPE "FarmSubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'GRACE', 'SUSPENDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FarmUnitKind" AS ENUM ('BLOCK', 'FIELD', 'PADDOCK', 'PEN', 'POULTRY_HOUSE', 'POND', 'APIARY', 'STORE', 'FEED_MILL', 'OTHER');

-- CreateEnum
CREATE TYPE "FarmEnterpriseKind" AS ENUM ('DAIRY', 'BEEF', 'LAYERS', 'BROILERS', 'KIENYEJI', 'PIGS', 'GOATS', 'SHEEP', 'RABBITS', 'FISH', 'BEES', 'CROP', 'FODDER', 'FEED', 'OTHER');

-- CreateEnum
CREATE TYPE "FarmRoleCode" AS ENUM ('FARM_OWNER', 'FARM_MANAGER', 'HERDSMAN', 'VET', 'CROPS_OFFICER', 'FEED_MILLER', 'STOREKEEPER', 'SALES', 'AUDITOR');

-- CreateTable
CREATE TABLE "farm_plans" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fits" TEXT,
    "monthlyPrice" DECIMAL(14,2) NOT NULL,
    "annualPrice" DECIMAL(14,2),
    "quoteOnly" BOOLEAN NOT NULL DEFAULT false,
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "status" "FarmSubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "farmName" TEXT NOT NULL,
    "county" TEXT,
    "subCounty" TEXT,
    "ward" TEXT,
    "areaUnit" TEXT NOT NULL DEFAULT 'ACRE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_units" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "parentId" TEXT,
    "kind" "FarmUnitKind" NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "acres" DECIMAL(14,3),
    "capacity" INTEGER,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_enterprises" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "kind" "FarmEnterpriseKind" NOT NULL,
    "name" TEXT NOT NULL,
    "unitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "farm_enterprises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "farm_user_roles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orgUserId" TEXT NOT NULL,
    "role" "FarmRoleCode" NOT NULL,
    "unitIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "farm_user_roles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "farm_plans_code_key" ON "farm_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "farm_subscriptions_organizationId_key" ON "farm_subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "farm_settings_organizationId_key" ON "farm_settings"("organizationId");

-- CreateIndex
CREATE INDEX "farm_units_organizationId_kind_idx" ON "farm_units"("organizationId", "kind");

-- CreateIndex
CREATE INDEX "farm_enterprises_organizationId_idx" ON "farm_enterprises"("organizationId");

-- CreateIndex
CREATE INDEX "farm_user_roles_organizationId_idx" ON "farm_user_roles"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "farm_user_roles_orgUserId_role_key" ON "farm_user_roles"("orgUserId", "role");

-- AddForeignKey
ALTER TABLE "farm_units" ADD CONSTRAINT "farm_units_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "farm_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Launch plans (docs/farm/05-pricing-plans.md). Data, editable later by the ZARODA super-admin; never overwritten here.
INSERT INTO "farm_plans" ("id","code","name","fits","monthlyPrice","annualPrice","quoteOnly","limits","features","sortOrder","isActive","updatedAt") VALUES
 (gen_random_uuid()::text,'FARM_KIENYEJI','Kienyeji','A small family shamba',0,0,false,'{"head":20,"birds":200,"acres":2,"users":1}','["layout","livestock","production","crops","sales_cash","reports_basic"]',1,true,now()),
 (gen_random_uuid()::text,'FARM_MKULIMA','Mkulima','A small commercial farm',1000,10000,false,'{"head":100,"birds":2000,"acres":10,"users":3}','["layout","livestock","production","crops","sales_cash","reports_basic","programmes","feed","sales_credit"]',2,true,now()),
 (gen_random_uuid()::text,'FARM_FARMER','Farmer','A growing mixed farm',2500,25000,false,'{"head":500,"birds":10000,"acres":50,"users":8}','["layout","livestock","production","crops","sales_cash","reports_basic","programmes","feed","sales_credit","labour","reports_full","ledger"]',3,true,now()),
 (gen_random_uuid()::text,'FARM_COMMERCIAL','Commercial','A large farm or ranch',6500,65000,false,'{"head":3000,"birds":100000,"acres":300,"users":25}','["layout","livestock","production","crops","sales_cash","reports_basic","programmes","feed","sales_credit","labour","reports_full","ledger","multi_site"]',4,true,now()),
 (gen_random_uuid()::text,'FARM_ESTATE','Estate','Estates, co-ops and groups',0,null,true,'{"head":null,"birds":null,"acres":null,"users":null}','["layout","livestock","production","crops","sales_cash","reports_basic","programmes","feed","sales_credit","labour","reports_full","ledger","multi_site","enterprise"]',5,true,now())
ON CONFLICT ("code") DO NOTHING;
