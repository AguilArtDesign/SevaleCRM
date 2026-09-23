-- Estado de sincronización del cupón con las tiendas. Se recalcula en cada intento de
-- sincronización y permite distinguir «pendiente» de «error» en el panel, algo que los
-- identificadores externos por sí solos no permiten.
ALTER TABLE `coupons`
    ADD COLUMN `sync_status` ENUM('PENDING', 'SYNCED', 'PARTIAL', 'ERROR') NOT NULL DEFAULT 'PENDING';

-- Los cupones que ya estaban sincronizados conservan su estado real.
UPDATE `coupons`
SET `sync_status` = 'SYNCED'
WHERE `seratus_coupon_id` IS NOT NULL AND `pali_coupon_id` IS NOT NULL;

UPDATE `coupons`
SET `sync_status` = 'PARTIAL'
WHERE (`seratus_coupon_id` IS NOT NULL) <> (`pali_coupon_id` IS NOT NULL);
