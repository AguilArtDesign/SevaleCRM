-- Identificador del usuario como vendedor en Siigo. La columna es opcional a nivel de base de
-- datos para no romper las inserciones que ya existen (seed, pruebas y cualquier integración que
-- cree usuarios), pero la aplicación exige el valor al crear o editar una cuenta. El índice único
-- impide que dos usuarios del CRM apunten al mismo vendedor de Siigo.
ALTER TABLE `users`
  ADD COLUMN `seller_id` INTEGER NULL;

CREATE UNIQUE INDEX `users_seller_id_key` ON `users`(`seller_id`);

-- El administrador inicial ya está registrado en Siigo con este identificador.
UPDATE `users`
SET `seller_id` = 820
WHERE `email` = 'disenoweb@sevale.com' AND `seller_id` IS NULL;
