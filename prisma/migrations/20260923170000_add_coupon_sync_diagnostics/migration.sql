-- Diagnóstico por tienda del último intento de sincronización. Se conserva en la fila para que
-- un administrador pueda comprobar por qué un cupón quedó «parcial» o «error» mucho después del
-- intento, cuando el resumen del momento y el log del servidor ya no están a mano.
ALTER TABLE `coupons`
    ADD COLUMN `last_sync_at` DATETIME(3) NULL,
    ADD COLUMN `seratus_last_error_code` VARCHAR(100) NULL,
    ADD COLUMN `seratus_last_error_message` TEXT NULL,
    ADD COLUMN `pali_last_error_code` VARCHAR(100) NULL,
    ADD COLUMN `pali_last_error_message` TEXT NULL;
