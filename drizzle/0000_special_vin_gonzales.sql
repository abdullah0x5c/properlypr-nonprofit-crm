CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization` text NOT NULL,
	`kind` text NOT NULL,
	`stamp` text NOT NULL,
	`author` text NOT NULL,
	`body` text NOT NULL,
	FOREIGN KEY (`organization`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`profile` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
