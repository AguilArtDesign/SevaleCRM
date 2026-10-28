-- AlterTable
ALTER TABLE `customers` ADD COLUMN `created_by_user_id` VARCHAR(36) NULL;

-- CreateTable
CREATE TABLE `customer_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NULL,
    `action` ENUM('CREATED', 'UPDATED', 'SYNCED', 'DELETED') NOT NULL,
    `origin` ENUM('LIVE', 'BACKFILL') NOT NULL DEFAULT 'LIVE',
    `user_id` VARCHAR(36) NULL,
    `user_name` VARCHAR(191) NULL,
    `customer_name` VARCHAR(255) NULL,
    `customer_document` VARCHAR(20) NULL,
    `changes` JSON NULL,
    `provider` ENUM('SIIGO', 'SERATUS', 'PALI') NULL,
    `outcome` ENUM('SYNCED', 'ERROR') NULL,
    `message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customer_events_customer_id_created_at_idx`(`customer_id`, `created_at`),
    INDEX `customer_events_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `customer_events_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `customers_created_by_user_id_idx` ON `customers`(`created_by_user_id`);

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_events` ADD CONSTRAINT `customer_events_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_events` ADD CONSTRAINT `customer_events_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
