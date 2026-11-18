-- AlterTable
ALTER TABLE `products` ADD COLUMN `siigo_warehouses` JSON NULL,
    ADD COLUMN `siigo_warehouses_updated_at` DATETIME(3) NULL;
