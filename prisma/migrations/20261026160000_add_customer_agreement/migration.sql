-- AlterTable
ALTER TABLE `customers` ADD COLUMN `agreement_id` INTEGER NULL;

-- CreateIndex
CREATE INDEX `customers_agreement_id_idx` ON `customers`(`agreement_id`);

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_agreement_id_fkey` FOREIGN KEY (`agreement_id`) REFERENCES `agreements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Los convenios se leían solo a través del prospecto. A partir de aquí el cliente guarda el suyo,
-- así que se hereda el del prospecto que lo originó para que esos clientes no desaparezcan del
-- convenio al cambiar la consulta.
UPDATE `customers` `c`
JOIN `prospects` `p` ON `p`.`converted_customer_id` = `c`.`id`
SET `c`.`agreement_id` = `p`.`agreement_id`
WHERE `c`.`agreement_id` IS NULL AND `p`.`agreement_id` IS NOT NULL;
