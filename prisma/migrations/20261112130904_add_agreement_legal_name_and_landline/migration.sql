-- AlterTable
ALTER TABLE `agreements` ADD COLUMN `contact_extension` VARCHAR(10) NULL,
    ADD COLUMN `contact_landline` VARCHAR(32) NULL,
    ADD COLUMN `legal_name` VARCHAR(255) NULL;
