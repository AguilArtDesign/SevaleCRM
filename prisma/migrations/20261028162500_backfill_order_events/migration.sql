-- Reconstruye la traza de los pedidos que ya existían antes de la tabla `order_events`. Cada fila
-- queda con `origin` BACKFILL, que es lo que el panel muestra como «Reconstruido».
--
-- Solo se reconstruye lo que es un hecho comprobable en la propia fila del pedido:
--   1. El alta: `created_at` y `created_by_user_id` son los que se guardaron al crear la operación.
--   2. Cada sincronización con tienda: `last_sync_at` dice cuándo fue el último intento y el estado
--      guardado dice si terminó bien o mal. El autor no se guardó nunca, así que queda en nulo.
--   3. La cotización de Siigo: `synced_at`, el número y el error son los que devolvió Siigo.
--
-- El cierre de la operación (`COMPLETED`) NO se reconstruye: quién lo hizo no quedó registrado en
-- ninguna parte y atribuirlo al creador sería inventar evidencia. Su efecto ya se ve en el estado
-- de la operación y en las sincronizaciones reconstruidas.
--
-- Es idempotente: cada bloque salta los pedidos que ya tienen ese evento.

-- 1. Alta de la operación.
INSERT INTO `order_events` (
    `operation_id`,
    `action`,
    `origin`,
    `user_id`,
    `user_name`,
    `operation_code`,
    `customer_name`,
    `changes`,
    `provider`,
    `outcome`,
    `message`,
    `created_at`
)
SELECT
    `op`.`id`,
    'CREATED',
    'BACKFILL',
    `op`.`created_by_user_id`,
    (SELECT `u`.`name` FROM `users` `u` WHERE `u`.`id` = `op`.`created_by_user_id`),
    `op`.`operation_code`,
    (SELECT `c`.`display_name` FROM `customers` `c` WHERE `c`.`id` = `op`.`customer_id`),
    NULL,
    NULL,
    NULL,
    CASE
        WHEN `op`.`source` = 'WOOCOMMERCE'
            THEN 'Alta reconstruida: el pedido lo creó la tienda, no un usuario del CRM.'
        WHEN `op`.`created_by_user_id` IS NULL
            THEN 'Alta reconstruida: no se registró quién creó el pedido.'
        ELSE NULL
    END,
    `op`.`created_at`
FROM `order_operations` `op`
WHERE `op`.`deleted_at` IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM `order_events` `e`
      WHERE `e`.`operation_id` = `op`.`id`
        AND `e`.`action` = 'CREATED'
  );

-- 2. Un evento por tienda y por último intento guardado. Si el intento terminó en error, el mensaje
--    que ve el administrador es el que dejó la integración; si terminó bien, se advierte que el
--    autor es desconocido para que «Sistema» no se lea como una sincronización automática.
INSERT INTO `order_events` (
    `operation_id`,
    `action`,
    `origin`,
    `user_id`,
    `user_name`,
    `operation_code`,
    `customer_name`,
    `changes`,
    `provider`,
    `outcome`,
    `message`,
    `created_at`
)
SELECT
    `op`.`id`,
    'SYNCED',
    'BACKFILL',
    NULL,
    NULL,
    `op`.`operation_code`,
    (SELECT `c`.`display_name` FROM `customers` `c` WHERE `c`.`id` = `op`.`customer_id`),
    NULL,
    `o`.`store`,
    CASE WHEN `o`.`sync_status` = 'SYNCED' THEN 'SYNCED' ELSE 'ERROR' END,
    CASE
        WHEN `o`.`sync_status` = 'ERROR' THEN `o`.`last_sync_error_message`
        ELSE 'Sincronización reconstruida: se desconoce qué usuario la ejecutó.'
    END,
    `o`.`last_sync_at`
FROM `orders` `o`
JOIN `order_operations` `op` ON `op`.`id` = `o`.`operation_id`
WHERE `op`.`deleted_at` IS NULL
  AND `o`.`last_sync_at` IS NOT NULL
  AND NOT EXISTS (
      SELECT 1
      FROM `order_events` `e`
      WHERE `e`.`operation_id` = `op`.`id`
        AND `e`.`action` = 'SYNCED'
        AND `e`.`provider` = `o`.`store`
  );

-- 3. Cotización de Siigo, con el número o el motivo del fallo que devolvió el proveedor.
INSERT INTO `order_events` (
    `operation_id`,
    `action`,
    `origin`,
    `user_id`,
    `user_name`,
    `operation_code`,
    `customer_name`,
    `changes`,
    `provider`,
    `outcome`,
    `message`,
    `created_at`
)
SELECT
    `op`.`id`,
    'QUOTED',
    'BACKFILL',
    NULL,
    NULL,
    `op`.`operation_code`,
    (SELECT `c`.`display_name` FROM `customers` `c` WHERE `c`.`id` = `op`.`customer_id`),
    NULL,
    'SIIGO',
    CASE WHEN `q`.`status` = 'SYNCED' THEN 'SYNCED' ELSE 'ERROR' END,
    CASE
        WHEN `q`.`status` = 'SYNCED' THEN COALESCE(`q`.`number`, `q`.`name`)
        ELSE `q`.`error_message`
    END,
    COALESCE(`q`.`synced_at`, `q`.`updated_at`)
FROM `siigo_quotations` `q`
JOIN `order_operations` `op` ON `op`.`id` = `q`.`operation_id`
WHERE `op`.`deleted_at` IS NULL
  AND `q`.`status` IN ('SYNCED', 'ERROR')
  AND NOT EXISTS (
      SELECT 1
      FROM `order_events` `e`
      WHERE `e`.`operation_id` = `op`.`id`
        AND `e`.`action` = 'QUOTED'
  );
