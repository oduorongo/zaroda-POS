-- School supplier: quotations. A price quotation to a school; issued ones are frozen; when the school accepts, an order is made
-- at the quoted prices. Additive only.

-- CreateEnum
CREATE TYPE "SchoolQuoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "school_quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "quoteNumber" TEXT,
    "status" "SchoolQuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" DATE,
    "terms" TEXT,
    "issueDate" DATE,
    "issuedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decidedBy" TEXT,
    "decisionNote" TEXT,
    "revisionOfId" TEXT,
    "orderId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "school_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "school_quote_lines" (
    "id" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "variantSku" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "taxRate" DECIMAL(6,4) NOT NULL DEFAULT 0,

    CONSTRAINT "school_quote_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "school_quotes_quoteNumber_key" ON "school_quotes"("quoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "school_quotes_orderId_key" ON "school_quotes"("orderId");

-- CreateIndex
CREATE INDEX "school_quotes_organizationId_status_idx" ON "school_quotes"("organizationId", "status");

-- CreateIndex
CREATE INDEX "school_quotes_schoolId_idx" ON "school_quotes"("schoolId");

-- CreateIndex
CREATE INDEX "school_quote_lines_quoteId_idx" ON "school_quote_lines"("quoteId");

-- AddForeignKey
ALTER TABLE "school_quotes" ADD CONSTRAINT "school_quotes_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_quotes" ADD CONSTRAINT "school_quotes_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "supplier_schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_quotes" ADD CONSTRAINT "school_quotes_revisionOfId_fkey" FOREIGN KEY ("revisionOfId") REFERENCES "school_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_quotes" ADD CONSTRAINT "school_quotes_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "school_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_quote_lines" ADD CONSTRAINT "school_quote_lines_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "school_quotes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "school_quote_lines" ADD CONSTRAINT "school_quote_lines_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
