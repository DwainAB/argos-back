-- AlterTable
ALTER TABLE `Subscription` ADD COLUMN `codeAnalysesLimitWarningsSentThisPeriod` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `codeAnalysesUsedThisPeriod` INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE `CodeAnalysis` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'running',
    `filesScanned` INTEGER NULL,
    `scores` JSON NULL,
    `findings` JSON NULL,
    `errorMessage` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `CodeAnalysis_projectId_createdAt_idx`(`projectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CodeAnalysis` ADD CONSTRAINT `CodeAnalysis_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
