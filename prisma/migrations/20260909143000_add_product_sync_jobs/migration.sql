-- CreateTable
CREATE TABLE `product_sync_jobs` (
    `id` VARCHAR(36) NOT NULL,
    `requested_by_id` VARCHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `total` INTEGER NOT NULL,
    `processed` INTEGER NOT NULL DEFAULT 0,
    `succeeded` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `product_sync_jobs_status_created_at_idx`(`status`, `created_at`),
    INDEX `product_sync_jobs_requested_by_id_idx`(`requested_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_sync_job_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_id` VARCHAR(36) NOT NULL,
    `product_id` INTEGER NOT NULL,
    `sku` VARCHAR(191) NOT NULL,
    `product_name` VARCHAR(255) NOT NULL,
    `store` ENUM('SERATUS', 'PALI') NOT NULL,
    `woo_parent_id` BIGINT UNSIGNED NULL,
    `woo_product_id` BIGINT UNSIGNED NOT NULL,
    `price_cop` DECIMAL(14, 2) NOT NULL,
    `price_usd` DECIMAL(14, 2) NOT NULL,
    `stock` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'SYNCED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `processed_at` DATETIME(3) NULL,

    INDEX `product_sync_job_items_job_id_status_idx`(`job_id`, `status`),
    UNIQUE INDEX `product_sync_job_items_job_id_product_id_key`(`job_id`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_sync_jobs` ADD CONSTRAINT `product_sync_jobs_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_sync_job_items` ADD CONSTRAINT `product_sync_job_items_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `product_sync_jobs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
