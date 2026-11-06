-- CreateTable
CREATE TABLE `points_redemptions` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `document_number` VARCHAR(32) NOT NULL,
    `document_type` VARCHAR(4) NOT NULL,
    `customer_name` VARCHAR(191) NULL,
    `points_requested` INTEGER NOT NULL,
    `points_redeemed` INTEGER NULL,
    `points_balance` INTEGER NULL,
    `amount_cop` DECIMAL(18, 2) NOT NULL,
    `approbation_number` VARCHAR(128) NULL,
    `transaction_identifier` JSON NOT NULL,
    `validation_method` VARCHAR(20) NULL,
    `status` ENUM('PROCESSING', 'PENDING_INVOICE', 'COMPLETED', 'FAILED', 'UNVERIFIED') NOT NULL DEFAULT 'PROCESSING',
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `siigo_invoice_id` VARCHAR(64) NULL,
    `invoice_name` VARCHAR(64) NULL,
    `invoice_date` DATE NULL,
    `invoice_total` DECIMAL(18, 2) NULL,
    `created_by_user_id` VARCHAR(36) NULL,
    `completed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `points_redemptions_status_idx`(`status`),
    INDEX `points_redemptions_document_number_idx`(`document_number`),
    INDEX `points_redemptions_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `points_redemptions` ADD CONSTRAINT `points_redemptions_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
