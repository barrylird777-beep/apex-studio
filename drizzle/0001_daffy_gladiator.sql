PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_budget_items` (
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
INSERT INTO `__new_budget_items`("id", "project_id", "category", "description", "estimated", "actual", "notes") SELECT "id", "project_id", "category", "description", "estimated", "actual", "notes" FROM `budget_items`;--> statement-breakpoint
DROP TABLE `budget_items`;--> statement-breakpoint
ALTER TABLE `__new_budget_items` RENAME TO `budget_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;