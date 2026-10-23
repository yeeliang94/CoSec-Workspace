CREATE TABLE `account` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(255) NOT NULL,
	`provider_id` varchar(255) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` timestamp(3),
	`refresh_token_expires_at` timestamp(3),
	`scope` text,
	`password` text,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	CONSTRAINT `account_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` varchar(36) NOT NULL,
	`actor_id` varchar(36) NOT NULL,
	`company_id` varchar(36),
	`action` varchar(100) NOT NULL,
	`subject_id` varchar(80) NOT NULL,
	`detail` json NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `audit_events_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` varchar(36) NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `companies_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `documents` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `documents_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`period_key` varchar(80),
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `jobs_period_unique` UNIQUE(`period_key`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `officer_events` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `officer_events_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` varchar(180) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `reminders_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `mutation_requests` (
	`id` varchar(180) NOT NULL,
	`result` json NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `mutation_requests_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `session` (
	`id` varchar(36) NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`token` varchar(255) NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` varchar(36) NOT NULL,
	CONSTRAINT `session_id` PRIMARY KEY(`id`),
	CONSTRAINT `session_token_unique` UNIQUE(`token`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `settings` (
	`id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `settings_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `user` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`email_verified` boolean NOT NULL DEFAULT false,
	`image` text,
	`created_at` timestamp(3) NOT NULL,
	`updated_at` timestamp(3) NOT NULL,
	`capabilities` json NOT NULL,
	`company_ids` json NOT NULL,
	`preferences` json NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `user_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_email_unique` UNIQUE(`email`)
) ENGINE=InnoDB;
--> statement-breakpoint
CREATE TABLE `verification` (
	`id` varchar(36) NOT NULL,
	`identifier` varchar(255) NOT NULL,
	`value` text NOT NULL,
	`expires_at` timestamp(3) NOT NULL,
	`created_at` timestamp(3),
	`updated_at` timestamp(3),
	CONSTRAINT `verification_id` PRIMARY KEY(`id`)
) ENGINE=InnoDB;
--> statement-breakpoint
ALTER TABLE `account` ADD CONSTRAINT `account_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `documents` ADD CONSTRAINT `documents_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `jobs` ADD CONSTRAINT `jobs_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `officer_events` ADD CONSTRAINT `officer_events_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `reminders` ADD CONSTRAINT `reminders_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `session` ADD CONSTRAINT `session_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE cascade ON UPDATE no action;