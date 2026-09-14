-- El CRM puede conservar clientes incompletos provenientes de Siigo.
-- Las reglas obligatorias de cada proveedor se validan al sincronizar.
ALTER TABLE `customers`
    MODIFY `email` VARCHAR(191) NULL,
    MODIFY `country` VARCHAR(2) NULL,
    MODIFY `region` VARCHAR(32) NULL,
    MODIFY `city_code` VARCHAR(32) NULL,
    MODIFY `address_line_1` VARCHAR(255) NULL;
