-- CreateTable
CREATE TABLE `Alert` (
    `id` VARCHAR(191) NOT NULL,
    `explanation` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `proposedFilePath` TEXT NULL,
    `proposedOldCode` TEXT NULL,
    `proposedNewCode` TEXT NULL,
    `pullRequestUrl` VARCHAR(191) NULL,
    `logEntryId` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `Alert_logEntryId_key`(`logEntryId`),
    INDEX `Alert_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Alert` ADD CONSTRAINT `Alert_logEntryId_fkey` FOREIGN KEY (`logEntryId`) REFERENCES `LogEntry`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
