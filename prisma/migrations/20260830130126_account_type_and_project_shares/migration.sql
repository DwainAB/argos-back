/*
  Warnings:

  - You are about to drop the `Organization` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OrganizationMembership` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `OrganizationMembership` DROP FOREIGN KEY `OrganizationMembership_organizationId_fkey`;

-- DropForeignKey
ALTER TABLE `OrganizationMembership` DROP FOREIGN KEY `OrganizationMembership_userId_fkey`;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `accountType` VARCHAR(191) NOT NULL DEFAULT 'personal',
    ADD COLUMN `organizationName` VARCHAR(191) NULL;

-- DropTable
DROP TABLE `Organization`;

-- DropTable
DROP TABLE `OrganizationMembership`;

-- CreateTable
CREATE TABLE `ProjectShare` (
    `id` VARCHAR(191) NOT NULL,
    `projectId` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `sharedWithUserId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ProjectShare_sharedWithUserId_idx`(`sharedWithUserId`),
    INDEX `ProjectShare_email_idx`(`email`),
    UNIQUE INDEX `ProjectShare_projectId_email_key`(`projectId`, `email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ProjectShare` ADD CONSTRAINT `ProjectShare_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ProjectShare` ADD CONSTRAINT `ProjectShare_sharedWithUserId_fkey` FOREIGN KEY (`sharedWithUserId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
