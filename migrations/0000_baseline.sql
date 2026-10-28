CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text NOT NULL,
	`company_id` text,
	`action` text NOT NULL,
	`subject_id` text NOT NULL,
	`detail` text NOT NULL,
	`created_at` integer NOT NULL,
	`entity_type` text,
	`request_id` text,
	`reason` text,
	`sensitivity` text DEFAULT 'General' NOT NULL,
	`scope_company_ids` text
);
--> statement-breakpoint
CREATE INDEX `audit_events_company_time` ON `audit_events` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_time` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity` ON `audit_events` (`entity_type`,`subject_id`);--> statement-breakpoint
CREATE TABLE `clause_template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`clause_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`clause_id`) REFERENCES `clause_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clause_versions_unique` ON `clause_template_versions` (`clause_id`,`version`);--> statement-breakpoint
CREATE TABLE `clause_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `companies` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `company_profiles` (
	`company_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company_registers` (
	`company_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `company_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`person_id` text NOT NULL,
	`role` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `company_relationships_company` ON `company_relationships` (`company_id`,`role`);--> statement-breakpoint
CREATE INDEX `company_relationships_person` ON `company_relationships` (`person_id`);--> statement-breakpoint
CREATE TABLE `document_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`case_id` text NOT NULL,
	`company_id` text NOT NULL,
	`status` text NOT NULL,
	`request_key` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `resolution_cases`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_generations_request` ON `document_generations` (`request_key`);--> statement-breakpoint
CREATE INDEX `document_generations_case` ON `document_generations` (`case_id`);--> statement-breakpoint
CREATE INDEX `document_generations_family` ON `document_generations` (`family_id`);--> statement-breakpoint
CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `generation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`generation_id` text NOT NULL,
	`company_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `document_generations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `generation_records_generation` ON `generation_records` (`generation_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`period_key` text,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_period_unique` ON `jobs` (`period_key`);--> statement-breakpoint
CREATE TABLE `officer_events` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `output_types` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `people_full_name` ON `people` (`full_name`);--> statement-breakpoint
CREATE TABLE `record_field_definitions` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `reminders_open_by_company` ON `reminders` (`company_id`,`resolved`);--> statement-breakpoint
CREATE TABLE `mutation_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`result` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mutation_requests_created_at` ON `mutation_requests` (`created_at`);--> statement-breakpoint
CREATE TABLE `resolution_assemblies` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resolution_assembly_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`assembly_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`assembly_id`) REFERENCES `resolution_assemblies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assembly_versions_unique` ON `resolution_assembly_versions` (`assembly_id`,`version`);--> statement-breakpoint
CREATE TABLE `resolution_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`company_id` text NOT NULL,
	`job_id` text,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `resolution_cases_company` ON `resolution_cases` (`company_id`);--> statement-breakpoint
CREATE INDEX `resolution_cases_job` ON `resolution_cases` (`job_id`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`capabilities` text NOT NULL,
	`company_ids` text NOT NULL,
	`preferences` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (lower("email"));--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
INSERT INTO `output_types` (`id`, `data`) VALUES ('directors_written', json_object('id','directors_written','name','Directors'' written resolution','body','directors','active',json('true'),'order',1)), ('members_written', json_object('id','members_written','name','Members'' written resolution','body','members','active',json('true'),'order',2));
