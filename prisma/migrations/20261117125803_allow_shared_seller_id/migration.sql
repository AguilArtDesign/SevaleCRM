-- El negocio cerro cuentas de Siigo que no se usaban y ahora varios comerciales comparten seller.
-- Se cambia la restriccion de unicidad por un indice simple: la identidad en el CRM es el correo.
DROP INDEX `users_seller_id_key` ON `users`;

CREATE INDEX `users_seller_id_idx` ON `users`(`seller_id`);
