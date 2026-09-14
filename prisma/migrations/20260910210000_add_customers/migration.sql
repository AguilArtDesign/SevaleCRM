-- CreateTable
CREATE TABLE `customers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `person_type` ENUM('PERSON', 'COMPANY') NOT NULL,
    `first_name` VARCHAR(191) NULL,
    `last_name` VARCHAR(191) NULL,
    `display_name` VARCHAR(255) NOT NULL,
    `company` VARCHAR(255) NULL,
    `document_type` VARCHAR(20) NOT NULL,
    `document_number` VARCHAR(20) NOT NULL,
    `check_digit` VARCHAR(1) NULL,
    `email` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(32) NULL,
    `country` VARCHAR(2) NOT NULL,
    `region` VARCHAR(32) NOT NULL,
    `city_code` VARCHAR(32) NOT NULL,
    `postal_code` VARCHAR(32) NULL,
    `address_line_1` VARCHAR(255) NOT NULL,
    `address_line_2` VARCHAR(255) NULL,
    `vat_responsible` BOOLEAN NOT NULL DEFAULT false,
    `fiscal_responsibilities` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    INDEX `customers_document_number_idx`(`document_number`),
    INDEX `customers_email_idx`(`email`),
    INDEX `customers_display_name_idx`(`display_name`),
    INDEX `customers_country_idx`(`country`),
    INDEX `customers_city_code_idx`(`city_code`),
    INDEX `customers_active_idx`(`active`),
    UNIQUE INDEX `customers_document_type_document_number_key`(`document_type`, `document_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `customer_integrations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customer_id` INTEGER NOT NULL,
    `provider` ENUM('SIIGO', 'SERATUS', 'PALI') NOT NULL,
    `external_id` VARCHAR(191) NULL,
    `status` ENUM('PENDING', 'SYNCED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `last_attempt_at` DATETIME(3) NULL,
    `last_synced_at` DATETIME(3) NULL,
    `last_error_code` VARCHAR(100) NULL,
    `last_error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customer_integrations_status_idx`(`status`),
    UNIQUE INDEX `customer_integrations_customer_id_provider_key`(`customer_id`, `provider`),
    UNIQUE INDEX `customer_integrations_provider_external_id_key`(`provider`, `external_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `customer_integrations` ADD CONSTRAINT `customer_integrations_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
