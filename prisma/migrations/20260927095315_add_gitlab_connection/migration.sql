-- AlterTable
ALTER TABLE `Project` ADD COLUMN `gitlabBranch` VARCHAR(191) NULL,
    ADD COLUMN `gitlabConnectionId` VARCHAR(191) NULL,
    ADD COLUMN `gitlabProjectId` INTEGER NULL,
    ADD COLUMN `gitlabRepo` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `gitlabId` INTEGER NULL;

-- CreateTable
CREATE TABLE `GitlabConnection` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `organizationId` VARCHAR(191) NULL,
    `gitlabUserId` INTEGER NOT NULL,
    `gitlabUserLogin` VARCHAR(191) NOT NULL,
    `encryptedAccessToken` TEXT NOT NULL,
    `encryptedRefreshToken` TEXT NOT NULL,
    `accessTokenExpiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GitlabConnection_userId_idx`(`userId`),
    INDEX `GitlabConnection_organizationId_idx`(`organizationId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_gitlabId_key` ON `User`(`gitlabId`);

-- AddForeignKey
ALTER TABLE `GitlabConnection` ADD CONSTRAINT `GitlabConnection_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GitlabConnection` ADD CONSTRAINT `GitlabConnection_organizationId_fkey` FOREIGN KEY (`organizationId`) REFERENCES `Organization`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Project` ADD CONSTRAINT `Project_gitlabConnectionId_fkey` FOREIGN KEY (`gitlabConnectionId`) REFERENCES `GitlabConnection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
