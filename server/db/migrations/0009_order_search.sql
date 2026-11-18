ALTER TABLE `orders` ADD `ts` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `user_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `name_key` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `name_lc` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `addr_lc` text;--> statement-breakpoint
CREATE INDEX `orders_user` ON `orders` (`user_id`);--> statement-breakpoint
CREATE INDEX `orders_cust` ON `orders` (`phone`,`user_id`,`status`,`total`,`ts`);