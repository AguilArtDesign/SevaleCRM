-- AlterTable
ALTER TABLE `users` ADD COLUMN `siigo_invoice_prefix` VARCHAR(20) NULL;

-- CreateTable
CREATE TABLE `points_invoices` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source` ENUM('SIIGO', 'UAT_SEED') NOT NULL DEFAULT 'SIIGO',
    `siigo_invoice_id` VARCHAR(64) NULL,
    `name` VARCHAR(64) NOT NULL,
    `invoice_date` DATE NOT NULL,
    `seller_id` INTEGER NULL,
    `customer_identification` VARCHAR(32) NOT NULL,
    `customer_document_type` VARCHAR(4) NULL,
    `total` DECIMAL(18, 2) NOT NULL,
    `item_count` INTEGER NOT NULL,
    `points` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNVERIFIED') NOT NULL DEFAULT 'PENDING',
    `created_by_user_id` VARCHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `points_invoices_siigo_invoice_id_key`(`siigo_invoice_id`),
    UNIQUE INDEX `points_invoices_name_key`(`name`),
    INDEX `points_invoices_status_idx`(`status`),
    INDEX `points_invoices_invoice_date_idx`(`invoice_date`),
    INDEX `points_invoices_seller_id_idx`(`seller_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `points_accruals` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `invoice_id` INTEGER NOT NULL,
    `user_id` VARCHAR(36) NOT NULL,
    `document_number` VARCHAR(32) NOT NULL,
    `document_type` VARCHAR(4) NOT NULL,
    `points_requested` INTEGER NOT NULL,
    `points_earned` INTEGER NULL,
    `points_balance` INTEGER NULL,
    `approbation_number` VARCHAR(128) NULL,
    `transaction_identifier` JSON NOT NULL,
    `status` ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'UNVERIFIED') NOT NULL DEFAULT 'PROCESSING',
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `balance_value_in_money` DECIMAL(18, 2) NULL,
    `balance_checked_at` DATETIME(3) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `points_accruals_invoice_id_idx`(`invoice_id`),
    INDEX `points_accruals_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `points_invoices` ADD CONSTRAINT `points_invoices_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `points_accruals` ADD CONSTRAINT `points_accruals_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `points_invoices`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `points_accruals` ADD CONSTRAINT `points_accruals_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
