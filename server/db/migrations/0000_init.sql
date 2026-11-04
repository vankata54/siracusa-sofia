CREATE TABLE `allergens` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`actor` text,
	`action` text
);
--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`course` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `celebrations` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`status` text
);
--> statement-breakpoint
CREATE TABLE `counters` (
	`name` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`date` text,
	`slug` text
);
--> statement-breakpoint
CREATE TABLE `feedback_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`status` text,
	`module` text
);
--> statement-breakpoint
CREATE INDEX `notes_status` ON `feedback_notes` (`status`);--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`cat` text NOT NULL,
	`name` text NOT NULL,
	`course` text NOT NULL,
	`comp` text DEFAULT '' NOT NULL,
	`weight` text DEFAULT '' NOT NULL,
	`price` real NOT NULL,
	`price_lv` real,
	`tags` text DEFAULT '[]' NOT NULL,
	`allergens` text DEFAULT '[]' NOT NULL,
	`no_onion` integer DEFAULT false NOT NULL,
	`share` integer DEFAULT false NOT NULL,
	`per100` integer DEFAULT false NOT NULL,
	`sold_out` integer DEFAULT false NOT NULL,
	`lunch_group` text,
	`lunch_date` text,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `menu_items_cat` ON `menu_items` (`cat`);--> statement-breakpoint
CREATE TABLE `offers` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`active` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `office_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`code` text
);
--> statement-breakpoint
CREATE INDEX `office_code` ON `office_orders` (`code`);--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` text NOT NULL,
	`item_id` text NOT NULL,
	`name` text,
	`qty` integer NOT NULL,
	`unit` real,
	`mods` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `order_lines_order` ON `order_lines` (`order_id`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`no` integer NOT NULL,
	`mode` text NOT NULL,
	`status` text NOT NULL,
	`phone` text,
	`total` real,
	`channel` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_no` ON `orders` (`no`);--> statement-breakpoint
CREATE INDEX `orders_status` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_phone` ON `orders` (`phone`);--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`order_no` text
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`date` text,
	`time` text,
	`table_id` text,
	`phone` text,
	`status` text
);
--> statement-breakpoint
CREATE INDEX `reservations_slot` ON `reservations` (`date`,`time`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`user_id` text,
	`kind` text,
	`expires_at` integer
);
--> statement-breakpoint
CREATE TABLE `sms_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `staff_users` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`username` text,
	`role` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_username` ON `staff_users` (`username`);--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`email` text
);
--> statement-breakpoint
CREATE TABLE `tables` (
	`id` text PRIMARY KEY NOT NULL,
	`n` integer NOT NULL,
	`zone` text NOT NULL,
	`seats` integer NOT NULL,
	`shape` text NOT NULL,
	`x` integer NOT NULL,
	`y` integer NOT NULL,
	`window` integer DEFAULT false NOT NULL,
	`stroller` integer DEFAULT false NOT NULL,
	`access` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`phone` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_phone` ON `users` (`phone`);