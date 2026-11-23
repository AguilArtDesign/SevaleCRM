-- AlterTable
ALTER TABLE `points_redemptions`
    ADD COLUMN `type` ENUM('REDEMPTION', 'MIXED') NOT NULL DEFAULT 'REDEMPTION',
    ADD COLUMN `points_earned` INTEGER NULL,
    ADD COLUMN `sale_total_cop` DECIMAL(18, 2) NULL,
    ADD COLUMN `cash_amount_cop` DECIMAL(18, 2) NULL;
