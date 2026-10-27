-- CreateTable
CREATE TABLE `integration_logs` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `integration` VARCHAR(50) NOT NULL,
    `operation` VARCHAR(100) NOT NULL,
    `outcome` ENUM('SUCCESS', 'ERROR') NOT NULL,
    `method` VARCHAR(10) NULL,
    `url` TEXT NULL,
    `status_code` INTEGER NULL,
    `code` VARCHAR(100) NULL,
    `message` TEXT NULL,
    `request_body` LONGTEXT NULL,
    `response_body` LONGTEXT NULL,
    `duration_ms` INTEGER NULL,
    `reference_type` VARCHAR(50) NULL,
    `reference_id` VARCHAR(64) NULL,
    `user_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `integration_logs_created_at_idx`(`created_at`),
    INDEX `integration_logs_integration_idx`(`integration`),
    INDEX `integration_logs_outcome_idx`(`outcome`),
    INDEX `integration_logs_code_idx`(`code`),
    INDEX `integration_logs_reference_type_reference_id_idx`(`reference_type`, `reference_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `integration_logs` ADD CONSTRAINT `integration_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
