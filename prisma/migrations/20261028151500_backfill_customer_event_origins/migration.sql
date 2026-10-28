-- Reconstruye el alta de los clientes que ya existían antes de la traza. Se marca con `origin`
-- BACKFILL para que el panel pueda distinguir un dato reconstruido de uno registrado en vivo, y
-- `message` explica de dónde sale la atribución.
--
-- El autor se toma del prospecto que originó al cliente. Cuando no hay prospecto (o lo creó alguien
-- que ya no está), se atribuye al administrador más antiguo, que es quien dio de alta la base
-- inicial. Es idempotente: no toca clientes que ya tengan un evento de alta.

-- 1. Autor del alta tomado del prospecto convertido.
UPDATE `customers` `c`
SET `c`.`created_by_user_id` = (
    SELECT `p`.`created_by_user_id`
    FROM `prospects` `p`
    WHERE `p`.`converted_customer_id` = `c`.`id`
      AND `p`.`created_by_user_id` IS NOT NULL
    ORDER BY `p`.`converted_at` DESC, `p`.`id` DESC
    LIMIT 1
)
WHERE `c`.`created_by_user_id` IS NULL;

-- 2. Sin prospecto de origen: se atribuye al administrador más antiguo.
UPDATE `customers` `c`
SET `c`.`created_by_user_id` = (
    SELECT `u`.`id`
    FROM `users` `u`
    WHERE `u`.`role` = 'ADMIN'
    ORDER BY `u`.`created_at` ASC
    LIMIT 1
)
WHERE `c`.`created_by_user_id` IS NULL;

-- 3. Un evento de alta por cliente, fechado cuando se convirtió el prospecto o, en su defecto,
--    cuando se guardó el cliente.
INSERT INTO `customer_events` (
    `customer_id`,
    `action`,
    `origin`,
    `user_id`,
    `user_name`,
    `customer_name`,
    `customer_document`,
    `changes`,
    `provider`,
    `outcome`,
    `message`,
    `created_at`
)
SELECT
    `c`.`id`,
    'CREATED',
    'BACKFILL',
    `c`.`created_by_user_id`,
    (SELECT `u`.`name` FROM `users` `u` WHERE `u`.`id` = `c`.`created_by_user_id`),
    `c`.`display_name`,
    `c`.`document_number`,
    NULL,
    NULL,
    NULL,
    CASE
        WHEN EXISTS (
            SELECT 1
            FROM `prospects` `p`
            WHERE `p`.`converted_customer_id` = `c`.`id`
              AND `p`.`created_by_user_id` IS NOT NULL
        ) THEN NULL
        ELSE 'Alta reconstruida: no se registró quién creó el cliente. Se atribuye al administrador.'
    END,
    COALESCE(
        (
            SELECT `p`.`converted_at`
            FROM `prospects` `p`
            WHERE `p`.`converted_customer_id` = `c`.`id`
              AND `p`.`converted_at` IS NOT NULL
            ORDER BY `p`.`converted_at` DESC
            LIMIT 1
        ),
        `c`.`created_at`
    )
FROM `customers` `c`
WHERE NOT EXISTS (
    SELECT 1
    FROM `customer_events` `e`
    WHERE `e`.`customer_id` = `c`.`id`
      AND `e`.`action` = 'CREATED'
);
