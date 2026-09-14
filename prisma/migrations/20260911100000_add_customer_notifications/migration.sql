ALTER TABLE `notifications`
  ADD COLUMN `customer_id` INTEGER NULL,
  ADD COLUMN `required_permission` VARCHAR(100) NULL;

CREATE INDEX `notifications_customer_id_idx` ON `notifications`(`customer_id`);
CREATE INDEX `notifications_required_permission_idx` ON `notifications`(`required_permission`);

ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_customer_id_fkey`
  FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
