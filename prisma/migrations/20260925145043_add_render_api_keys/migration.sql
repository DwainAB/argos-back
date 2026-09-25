/*
  Warnings:

  - You are about to drop the column `renderApiKey` on the `Project` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE `Project` DROP COLUMN `renderApiKey`,
    ADD COLUMN `renderApiKeyId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `RenderApiKey` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `organizationId` VARCHAR(191) NULL,
    `label` VARCHAR(191) NOT NULL DEFAULT 'Clé Render',
    `encryptedKey` TEXT NOT NULL,
    `lastFour` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RenderApiKey_userId_idx`(`userId`),
    INDEX `RenderApiKey_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RenderApiKey` ADD CONSTRAINT `RenderApiKey_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `RenderApiKey` ADD CONSTRAINT `RenderApiKey_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_renderApiKeyId_fkey` FOREIGN KEY (`renderApiKeyId`) REFERENCES `RenderApiKey`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
