-- La fecha de creación del pedido en WooCommerce pasa a ser también la fecha con la que se ordenan
-- el panel de Pedidos y el historial de cada cliente, así que necesita su propio índice.
CREATE INDEX `orders_woo_created_at_idx` ON `orders`(`woo_created_at`);

-- Los pedidos creados en el CRM que todavía no existen en ninguna tienda quedaron sin fecha de
-- WooCommerce. Su fecha de creación es la del CRM, así que se rellena con ella: sin este valor
-- quedarían al final del ordenamiento en lugar de entre los pedidos de su misma fecha.
UPDATE `orders`
SET `woo_created_at` = `created_at`
WHERE `woo_created_at` IS NULL;
