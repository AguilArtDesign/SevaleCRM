-- CreateTable
CREATE TABLE `order_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `operation_id` INTEGER NULL,
    `action` ENUM('CREATED', 'UPDATED', 'COMPLETED', 'SYNCED', 'QUOTED', 'DELETED') NOT NULL,
    `origin` ENUM('LIVE', 'BACKFILL') NOT NULL DEFAULT 'LIVE',
    `user_id` VARCHAR(36) NULL,
    `user_name` VARCHAR(191) NULL,
    `operation_code` VARCHAR(32) NOT NULL,
    `customer_name` VARCHAR(255) NULL,
    `changes` JSON NULL,
    `provider` VARCHAR(20) NULL,
    `outcome` ENUM('SYNCED', 'ERROR') NULL,
    `message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_events_operation_id_created_at_idx`(`operation_id`, `created_at`),
    INDEX `order_events_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `order_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_operation_id_fkey` FOREIGN KEY (`operation_id`) REFERENCES `order_operations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_events` ADD CONSTRAINT `order_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
