-- DropForeignKey
ALTER TABLE `PasswordResetToken` DROP FOREIGN KEY `PasswordResetToken_userId_fkey`;

-- DropIndex
DROP INDEX `User_googleId_key` ON `User`;

-- DropIndex
DROP INDEX `User_gitlabId_key` ON `User`;

-- DropIndex
DROP INDEX `User_githubId_key` ON `User`;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `githubId`,
    DROP COLUMN `gitlabId`,
    DROP COLUMN `googleId`,
    DROP COLUMN `passwordHash`,
    ADD COLUMN `clerkId` VARCHAR(191) NULL;

-- DropTable
DROP TABLE `PasswordResetToken`;

-- CreateIndex
CREATE UNIQUE INDEX `User_clerkId_key` ON `User`(`clerkId`);

