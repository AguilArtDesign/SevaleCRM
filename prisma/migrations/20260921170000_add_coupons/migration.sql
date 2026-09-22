CREATE TABLE `coupons` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `coupon` VARCHAR(64) NOT NULL,
    `description` VARCHAR(255) NULL,
    `type` VARCHAR(32) NOT NULL,
    `amount` DECIMAL(7, 2) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `coupons_coupon_key`(`coupon`),
    INDEX `coupons_active_idx`(`active`),
    INDEX `coupons_type_idx`(`type`),
    INDEX `coupons_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
