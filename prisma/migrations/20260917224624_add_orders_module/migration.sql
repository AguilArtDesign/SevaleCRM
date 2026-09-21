-- AlterTable
ALTER TABLE `notifications` ADD COLUMN `order_operation_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `order_operations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `operation_code` VARCHAR(32) NOT NULL,
    `source` ENUM('CRM', 'WOOCOMMERCE') NOT NULL,
    `status` ENUM('PENDING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `customer_id` INTEGER NOT NULL,
    `created_by_user_id` VARCHAR(36) NULL,
    `currency` CHAR(3) NOT NULL,
    `payment_method` VARCHAR(191) NULL,
    `payment_method_title` VARCHAR(191) NULL,
    `shipping_method` VARCHAR(191) NULL,
    `shipping_method_title` VARCHAR(191) NULL,
    `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `shipping_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `billing_first_name` VARCHAR(191) NULL,
    `billing_last_name` VARCHAR(191) NULL,
    `billing_company` VARCHAR(255) NULL,
    `billing_address_1` VARCHAR(255) NULL,
    `billing_address_2` VARCHAR(255) NULL,
    `billing_city` VARCHAR(191) NULL,
    `billing_state` VARCHAR(32) NULL,
    `billing_postcode` VARCHAR(32) NULL,
    `billing_country` VARCHAR(2) NULL,
    `billing_email` VARCHAR(191) NULL,
    `billing_phone` VARCHAR(32) NULL,
    `shipping_first_name` VARCHAR(191) NULL,
    `shipping_last_name` VARCHAR(191) NULL,
    `shipping_company` VARCHAR(255) NULL,
    `shipping_address_1` VARCHAR(255) NULL,
    `shipping_address_2` VARCHAR(255) NULL,
    `shipping_city` VARCHAR(191) NULL,
    `shipping_state` VARCHAR(32) NULL,
    `shipping_postcode` VARCHAR(32) NULL,
    `shipping_country` VARCHAR(2) NULL,
    `shipping_phone` VARCHAR(32) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `deleted_at` DATETIME(3) NULL,

    UNIQUE INDEX `order_operations_operation_code_key`(`operation_code`),
    INDEX `order_operations_customer_id_idx`(`customer_id`),
    INDEX `order_operations_created_by_user_id_idx`(`created_by_user_id`),
    INDEX `order_operations_status_idx`(`status`),
    INDEX `order_operations_source_idx`(`source`),
    INDEX `order_operations_created_at_idx`(`created_at`),
    INDEX `order_operations_deleted_at_idx`(`deleted_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `orders` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `operation_id` INTEGER NOT NULL,
    `store` ENUM('SERATUS', 'PALI') NOT NULL,
    `woo_order_id` BIGINT UNSIGNED NULL,
    `woo_status` VARCHAR(50) NULL,
    `woo_created_at` DATETIME(3) NULL,
    `woo_updated_at` DATETIME(3) NULL,
    `sync_status` ENUM('PENDING', 'SYNCING', 'SYNCED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `last_sync_at` DATETIME(3) NULL,
    `last_sync_error_code` VARCHAR(100) NULL,
    `last_sync_error_message` TEXT NULL,
    `subtotal` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `discount_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `shipping_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `orders_sync_status_idx`(`sync_status`),
    INDEX `orders_created_at_idx`(`created_at`),
    UNIQUE INDEX `orders_operation_id_store_key`(`operation_id`, `store`),
    UNIQUE INDEX `orders_store_woo_order_id_key`(`store`, `woo_order_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_items` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `product_id` INTEGER NULL,
    `sku_snapshot` VARCHAR(191) NOT NULL,
    `name_snapshot` VARCHAR(255) NOT NULL,
    `store_snapshot` ENUM('SERATUS', 'PALI') NOT NULL,
    `quantity` INTEGER NOT NULL,
    `original_price` DECIMAL(14, 2) NULL,
    `unit_price` DECIMAL(14, 2) NOT NULL,
    `price_modified` BOOLEAN NOT NULL DEFAULT false,
    `subtotal` DECIMAL(14, 2) NOT NULL,
    `discount_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `total` DECIMAL(14, 2) NOT NULL,
    `tax_class` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `order_items_order_id_idx`(`order_id`),
    INDEX `order_items_product_id_idx`(`product_id`),
    INDEX `order_items_sku_snapshot_idx`(`sku_snapshot`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `order_coupons` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `order_id` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `discount_total` DECIMAL(14, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `order_coupons_order_id_idx`(`order_id`),
    INDEX `order_coupons_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shipments` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `operation_id` INTEGER NOT NULL,
    `carrier` VARCHAR(191) NULL,
    `tracking_number` VARCHAR(191) NULL,
    `status` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `shipments_operation_id_key`(`operation_id`),
    INDEX `shipments_tracking_number_idx`(`tracking_number`),
    INDEX `shipments_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shipment_events` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shipment_id` INTEGER NOT NULL,
    `status` VARCHAR(100) NOT NULL,
    `note` TEXT NULL,
    `created_by_user_id` VARCHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `shipment_events_shipment_id_created_at_idx`(`shipment_id`, `created_at`),
    INDEX `shipment_events_created_by_user_id_idx`(`created_by_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `siigo_quotations` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `operation_id` INTEGER NOT NULL,
    `external_id` VARCHAR(191) NULL,
    `number` VARCHAR(100) NULL,
    `name` VARCHAR(191) NULL,
    `url` TEXT NULL,
    `seller_id` VARCHAR(191) NULL,
    `status` VARCHAR(100) NULL,
    `synced_at` DATETIME(3) NULL,
    `exchange_rate` DECIMAL(18, 6) NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `siigo_quotations_operation_id_key`(`operation_id`),
    UNIQUE INDEX `siigo_quotations_external_id_key`(`external_id`),
    INDEX `siigo_quotations_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `woo_order_deliveries` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `delivery_id` VARCHAR(191) NOT NULL,
    `store` ENUM('SERATUS', 'PALI') NOT NULL,
    `event` VARCHAR(100) NOT NULL,
    `woo_order_id` BIGINT UNSIGNED NULL,
    `order_id` INTEGER NULL,
    `status` ENUM('PENDING', 'PROCESSED', 'ERROR') NOT NULL DEFAULT 'PENDING',
    `processed_at` DATETIME(3) NULL,
    `error_code` VARCHAR(100) NULL,
    `error_message` TEXT NULL,
    `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `woo_order_deliveries_delivery_id_key`(`delivery_id`),
    INDEX `woo_order_deliveries_store_woo_order_id_idx`(`store`, `woo_order_id`),
    INDEX `woo_order_deliveries_status_received_at_idx`(`status`, `received_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `notifications_order_operation_id_idx` ON `notifications`(`order_operation_id`);

-- AddForeignKey
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_order_operation_id_fkey` FOREIGN KEY (`order_operation_id`) REFERENCES `order_operations`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_operations` ADD CONSTRAINT `order_operations_customer_id_fkey` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_operations` ADD CONSTRAINT `order_operations_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `orders` ADD CONSTRAINT `orders_operation_id_fkey` FOREIGN KEY (`operation_id`) REFERENCES `order_operations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `order_coupons` ADD CONSTRAINT `order_coupons_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipments` ADD CONSTRAINT `shipments_operation_id_fkey` FOREIGN KEY (`operation_id`) REFERENCES `order_operations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipment_events` ADD CONSTRAINT `shipment_events_shipment_id_fkey` FOREIGN KEY (`shipment_id`) REFERENCES `shipments`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shipment_events` ADD CONSTRAINT `shipment_events_created_by_user_id_fkey` FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `siigo_quotations` ADD CONSTRAINT `siigo_quotations_operation_id_fkey` FOREIGN KEY (`operation_id`) REFERENCES `order_operations`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `woo_order_deliveries` ADD CONSTRAINT `woo_order_deliveries_order_id_fkey` FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
