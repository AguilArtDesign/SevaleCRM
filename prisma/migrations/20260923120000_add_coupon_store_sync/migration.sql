-- Cupones: se agregan los datos que se sincronizan con Seratus y Pali, los identificadores
-- externos de cada tienda y se elimina `active` (los cupones ahora se eliminan explícitamente
-- desde el panel en lugar de desactivarse).
ALTER TABLE `coupons`
    DROP INDEX `coupons_active_idx`,
    DROP COLUMN `active`,
    ADD COLUMN `date_expires` DATETIME(3) NULL,
    ADD COLUMN `individual_use` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `exclude_sale_items` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `usage_limit` INTEGER NULL,
    ADD COLUMN `usage_limit_per_user` INTEGER NULL,
    ADD COLUMN `seratus_coupon_id` INTEGER NULL,
    ADD COLUMN `pali_coupon_id` INTEGER NULL;
