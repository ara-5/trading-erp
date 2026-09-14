-- AlterTable
ALTER TABLE "PurchaseBillLine" ADD COLUMN     "accountId" TEXT;

-- AlterTable
ALTER TABLE "PurchaseOrderLine" ADD COLUMN     "billedQty" DECIMAL(18,3) NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "PurchaseBillLine" ADD CONSTRAINT "PurchaseBillLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
