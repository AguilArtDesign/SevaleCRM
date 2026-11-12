-- AlterTable
ALTER TABLE `product_sync_job_items` ADD COLUMN `price_eur` DECIMAL(14, 2) NULL,
    ADD COLUMN `price_mxn` DECIMAL(14, 2) NULL;

-- AlterTable
ALTER TABLE `products` ADD COLUMN `siigo_price_eur` DECIMAL(14, 2) NULL,
    ADD COLUMN `siigo_price_mxn` DECIMAL(14, 2) NULL,
    ADD COLUMN `woo_price_eur` DECIMAL(14, 2) NULL,
    ADD COLUMN `woo_price_mxn` DECIMAL(14, 2) NULL;
