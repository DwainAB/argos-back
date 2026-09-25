-- AlterTable
ALTER TABLE `Project` ADD COLUMN `renderApiKey` TEXT NULL,
    ADD COLUMN `renderOwnerId` VARCHAR(191) NULL,
    ADD COLUMN `renderResourceId` VARCHAR(191) NULL;
