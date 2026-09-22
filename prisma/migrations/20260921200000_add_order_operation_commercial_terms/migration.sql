ALTER TABLE `order_operations`
  ADD COLUMN `coupon_id` INTEGER NULL,
  ADD COLUMN `coupon_code` VARCHAR(64) NULL,
  ADD COLUMN `coupon_type` VARCHAR(32) NULL,
  ADD COLUMN `coupon_amount` DECIMAL(7, 2) NULL;

CREATE INDEX `order_operations_coupon_id_idx` ON `order_operations`(`coupon_id`);

ALTER TABLE `order_operations`
  ADD CONSTRAINT `order_operations_coupon_id_fkey`
  FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
