ALTER TABLE `orders` ADD `day` text;--> statement-breakpoint
CREATE INDEX `orders_day` ON `orders` (`day`);