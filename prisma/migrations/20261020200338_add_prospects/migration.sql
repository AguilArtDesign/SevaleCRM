-- CreateTable
CREATE TABLE `prospects` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `person_type` ENUM('PERSON', 'COMPANY') NULL,
    `first_name` VARCHAR(191) NULL,
    `last_name` VARCHAR(191) NULL,
    `display_name` VARCHAR(255) NOT NULL,
    `company` VARCHAR(255) NULL,
    `document_type` VARCHAR(20) NULL,
    `document_number` VARCHAR(20) NULL,
    `check_digit` VARCHAR(1) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(32) NULL,
    `country` VARCHAR(2) NULL,
    `region` VARCHAR(32) NULL,
    `city_code` VARCHAR(32) NULL,
    `city_name` VARCHAR(191) NULL,
    `postal_code` VARCHAR(32) NULL,
    `address_line_1` VARCHAR(255) NULL,
    `address_line_2` VARCHAR(255) NULL,
    `agreement_id` INTEGER NULL,
    `source` ENUM('MANUAL', 'WHATSAPP', 'WEB', 'REFERRAL', 'OTHER') NOT NULL DEFAULT 'MANUAL',
    `status` ENUM('NEW', 'IN_PROGRESS', 'QUALIFIED', 'CONVERTED', 'LOST') NOT NULL DEFAULT 'NEW',
    `assigned_user_id` VARCHAR(36) NULL,
    `notes` TEXT NULL,
    `converted_customer_id` INTEGER NULL,
    `converted_at` DATETIME(3) NULL,
    `created_by_user_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `prospects_display_name_idx`(`display_name`),
    INDEX `prospects_document_number_idx`(`document_number`),
    INDEX `prospects_email_idx`(`email`),
    INDEX `prospects_status_idx`(`status`),
    INDEX `prospects_source_idx`(`source`),
    INDEX `prospects_assigned_user_id_idx`(`assigned_user_id`),
    INDEX `prospects_agreement_id_idx`(`agreement_id`),
    INDEX `prospects_converted_customer_id_idx`(`converted_customer_id`),
    INDEX `prospects_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `tags_name_key`(`name`),
    INDEX `tags_active_idx`(`active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prospect_tags` (
    `prospect_id` INTEGER NOT NULL,
    `tag_id` INTEGER NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `prospect_tags_tag_id_idx`(`tag_id`),
    PRIMARY KEY (`prospect_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_agreement_id_fkey` FOREIGN KEY (`agreement_id`) REFERENCES `agreements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_assigned_user_id_fkey` FOREIGN KEY (`assigned_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospects` ADD CONSTRAINT `prospects_converted_customer_id_fkey` FOREIGN KEY (`converted_customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospect_tags` ADD CONSTRAINT `prospect_tags_prospect_id_fkey` FOREIGN KEY (`prospect_id`) REFERENCES `prospects`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `prospect_tags` ADD CONSTRAINT `prospect_tags_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
