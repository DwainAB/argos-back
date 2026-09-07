-- DropForeignKey
ALTER TABLE `Alert` DROP FOREIGN KEY `Alert_logEntryId_fkey`;

-- DropForeignKey
ALTER TABLE `LogEntry` DROP FOREIGN KEY `LogEntry_projectId_fkey`;

-- DropForeignKey
ALTER TABLE `ProjectShare` DROP FOREIGN KEY `ProjectShare_projectId_fkey`;

-- AddForeignKey
ALTER TABLE `ProjectShare` ADD CONSTRAINT `ProjectShare_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LogEntry` ADD CONSTRAINT `LogEntry_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `Project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Alert` ADD CONSTRAINT `Alert_logEntryId_fkey` FOREIGN KEY (`logEntryId`) REFERENCES `LogEntry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
