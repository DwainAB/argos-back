-- AlterTable
ALTER TABLE `Subscription` ADD COLUMN `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `lastPaymentFailedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `StripeEvent` (
    `id` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `processedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
