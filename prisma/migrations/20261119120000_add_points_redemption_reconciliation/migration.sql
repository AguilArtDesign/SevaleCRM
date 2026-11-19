-- AlterTable
ALTER TABLE `points_redemptions` ADD COLUMN `reconciliation_outcome` ENUM('APPLIED', 'NOT_APPLIED') NULL,
    ADD COLUMN `reconciliation_note` TEXT NULL,
    ADD COLUMN `reconciled_at` DATETIME(3) NULL,
    ADD COLUMN `reconciled_by_user_id` VARCHAR(36) NULL;

-- AddForeignKey
ALTER TABLE `points_redemptions` ADD CONSTRAINT `points_redemptions_reconciled_by_user_id_fkey` FOREIGN KEY (`reconciled_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
