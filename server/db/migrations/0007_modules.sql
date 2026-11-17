CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `driver_asks` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`status` text
);
--> statement-breakpoint
CREATE TABLE `fuel_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`user_id` text
);
--> statement-breakpoint
CREATE TABLE `module_state` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text
);
--> statement-breakpoint
CREATE TABLE `shifts` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`user_id` text,
	`role` text,
	`status` text
);
--> statement-breakpoint
CREATE INDEX `shift_user` ON `shifts` (`user_id`,`status`);--> statement-breakpoint
CREATE TABLE `table_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` text,
	`updated_at` text,
	`table_id` text,
	`status` text
);
--> statement-breakpoint
CREATE INDEX `tsess_table` ON `table_sessions` (`table_id`,`status`);