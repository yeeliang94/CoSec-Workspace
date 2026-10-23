ALTER TABLE `reminders` ADD `resolved` boolean DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `reminders` SET `resolved` = true WHERE JSON_EXTRACT(`data`, '$.resolved') = true;--> statement-breakpoint
CREATE INDEX `reminders_open_by_company` ON `reminders` (`company_id`,`resolved`);--> statement-breakpoint
CREATE INDEX `mutation_requests_created_at` ON `mutation_requests` (`created_at`);