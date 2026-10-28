-- AlterTable
ALTER TABLE `order_operations` ADD COLUMN `updated_by_at` DATETIME(3) NULL,
    ADD COLUMN `updated_by_user_id` VARCHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `order_operations` ADD CONSTRAINT `order_operations_updated_by_user_id_fkey` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
