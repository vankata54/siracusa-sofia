CREATE TABLE `push_subs` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`order_no` text
);
--> statement-breakpoint
CREATE INDEX `push_order` ON `push_subs` (`order_no`);