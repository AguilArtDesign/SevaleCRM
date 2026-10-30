-- AlterTable
ALTER TABLE `points_accruals` ADD COLUMN `revocation_error_code` VARCHAR(100) NULL,
    ADD COLUMN `revocation_error_message` TEXT NULL,
    ADD COLUMN `revocation_identifier` JSON NULL,
    ADD COLUMN `revocation_status` ENUM('PROCESSING', 'COMPLETED', 'FAILED', 'UNVERIFIED') NULL,
    ADD COLUMN `revoked_at` DATETIME(3) NULL,
    ADD COLUMN `revoked_by_user_id` VARCHAR(36) NULL;

-- AlterTable
ALTER TABLE `points_invoices` MODIFY `status` ENUM('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'UNVERIFIED', 'REVOKING', 'REVOKED') NOT NULL DEFAULT 'PENDING';

-- AddForeignKey
ALTER TABLE `points_accruals` ADD CONSTRAINT `points_accruals_revoked_by_user_id_fkey` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
