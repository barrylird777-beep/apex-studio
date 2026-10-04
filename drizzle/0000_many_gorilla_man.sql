CREATE TABLE `budget_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`estimated` real DEFAULT 0,
	`actual` real DEFAULT 0,
	`notes` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `call_sheets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`shoot_day_id` integer NOT NULL,
	`general_call_time` text,
	`weather_notes` text,
	`special_requirements` text,
	`pdf_path` text,
	`created_at` integer,
	FOREIGN KEY (`shoot_day_id`) REFERENCES `shoot_days`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `characters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`canonical_name` text NOT NULL,
	`aliases` text DEFAULT '[]',
	`primary_stories` text DEFAULT '[]',
	`relationships` text DEFAULT '[]',
	`key_traits` text DEFAULT '[]',
	`notes` text,
	`scripture_references` text DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`primary_scripture` text,
	`status` text DEFAULT 'development',
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`scene_number` integer,
	`title` text,
	`scripture_ref` text NOT NULL,
	`location` text,
	`characters_present` text DEFAULT '[]',
	`action_summary` text,
	`emotional_beat` text,
	`production_notes` text,
	`estimated_pages` real,
	`day_or_night` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `shoot_day_scenes` (
	`scene_id` integer PRIMARY KEY NOT NULL,
	`shoot_day_id` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`scene_id`) REFERENCES `scenes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`shoot_day_id`) REFERENCES `shoot_days`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `shoot_day_scenes_day_position_idx` ON `shoot_day_scenes` (`shoot_day_id`,`position`);--> statement-breakpoint
CREATE TABLE `shoot_days` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`date` text NOT NULL,
	`call_time` text,
	`unit` text DEFAULT '1st Unit',
	`notes` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shoot_days_project_date_unique` ON `shoot_days` (`project_id`,`date`);--> statement-breakpoint
CREATE INDEX `shoot_days_project_date_idx` ON `shoot_days` (`project_id`,`date`);