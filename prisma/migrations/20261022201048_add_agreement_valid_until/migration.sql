-- AlterTable
ALTER TABLE `agreements` ADD COLUMN `valid_until` DATE NULL;

-- CreateIndex
CREATE INDEX `agreements_valid_until_idx` ON `agreements`(`valid_until`);
