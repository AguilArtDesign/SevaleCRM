-- CreateTable
CREATE TABLE `shipment_store_syncs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shipment_id` INTEGER NOT NULL,
    `store` ENUM('SERATUS', 'PALI') NOT NULL,
    `sync_status` ENUM('PENDING', 'SYNCING', 'SYNCED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `last_sync_at` DATETIME(3) NULL,
    `last_sync_error_code` VARCHAR(100) NULL,
    `last_sync_error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `shipment_store_syncs_sync_status_idx`(`sync_status`),
    UNIQUE INDEX `shipment_store_syncs_shipment_id_store_key`(`shipment_id`, `store`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `shipment_store_syncs` ADD CONSTRAINT `shipment_store_syncs_shipment_id_fkey` FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
