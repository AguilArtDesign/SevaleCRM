-- AlterTable
ALTER TABLE `order_operations` ADD COLUMN `reopened_at` DATETIME(3) NULL,
    ADD COLUMN `reopened_by_user_id` VARCHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `order_operations` ADD CONSTRAINT `order_operations_reopened_by_user_id_fkey` FOREIGN KEY (`reopened_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
