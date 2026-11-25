-- CreateTable
CREATE TABLE `product_refresh_jobs` (
    `id` VARCHAR(36) NOT NULL,
    `requested_by_id` VARCHAR(36) NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `pages_processed` INTEGER NOT NULL DEFAULT 0,
    `scanned` INTEGER NOT NULL DEFAULT 0,
    `matched` INTEGER NOT NULL DEFAULT 0,
    `updated` INTEGER NOT NULL DEFAULT 0,
    `synced` INTEGER NOT NULL DEFAULT 0,
    `out_of_sync` INTEGER NOT NULL DEFAULT 0,
    `discarded` INTEGER NOT NULL DEFAULT 0,
    `failed` INTEGER NOT NULL DEFAULT 0,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,

    INDEX `product_refresh_jobs_status_created_at_idx`(`status`, `created_at`),
    INDEX `product_refresh_jobs_requested_by_id_idx`(`requested_by_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `product_refresh_jobs` ADD CONSTRAINT `product_refresh_jobs_requested_by_id_fkey` FOREIGN KEY (`requested_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
