-- AlterTable
ALTER TABLE `User` ADD COLUMN `githubId` INTEGER NULL;

-- CreateIndex
CREATE UNIQUE INDEX `User_githubId_key` ON `User`(`githubId`);
