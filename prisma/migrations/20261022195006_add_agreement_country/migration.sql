-- AlterTable
ALTER TABLE `agreements` ADD COLUMN `city_name` VARCHAR(191) NULL,
    ADD COLUMN `country` VARCHAR(2) NOT NULL DEFAULT 'CO';

-- CreateIndex
CREATE INDEX `agreements_country_idx` ON `agreements`(`country`);
