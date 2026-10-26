CREATE TABLE `clause_template_versions` (
	`id` varchar(36) NOT NULL,
	`clause_id` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`status` varchar(20) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `clause_template_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `clause_versions_unique` UNIQUE(`clause_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `clause_templates` (
	`id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `clause_templates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `company_profiles` (
	`company_id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `company_profiles_company_id` PRIMARY KEY(`company_id`)
);
--> statement-breakpoint
CREATE TABLE `company_relationships` (
	`id` varchar(64) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`person_id` varchar(64) NOT NULL,
	`role` varchar(20) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `company_relationships_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `document_generations` (
	`id` varchar(36) NOT NULL,
	`family_id` varchar(36) NOT NULL,
	`case_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`status` varchar(20) NOT NULL,
	`request_key` varchar(180) NOT NULL,
	`data` json NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `document_generations_id` PRIMARY KEY(`id`),
	CONSTRAINT `document_generations_request` UNIQUE(`request_key`)
);
--> statement-breakpoint
CREATE TABLE `generation_records` (
	`id` varchar(36) NOT NULL,
	`generation_id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`kind` varchar(20) NOT NULL,
	`data` json NOT NULL,
	`created_at` timestamp(3) NOT NULL,
	CONSTRAINT `generation_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `output_types` (
	`id` varchar(64) NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `output_types_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `people` (
	`id` varchar(64) NOT NULL,
	`full_name` varchar(255) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `people_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `record_field_definitions` (
	`id` varchar(64) NOT NULL,
	`scope` varchar(20) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `record_field_definitions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `resolution_assemblies` (
	`id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `resolution_assemblies_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `resolution_assembly_versions` (
	`id` varchar(36) NOT NULL,
	`assembly_id` varchar(36) NOT NULL,
	`version` int NOT NULL,
	`status` varchar(20) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `resolution_assembly_versions_id` PRIMARY KEY(`id`),
	CONSTRAINT `assembly_versions_unique` UNIQUE(`assembly_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE `resolution_cases` (
	`id` varchar(36) NOT NULL,
	`company_id` varchar(36) NOT NULL,
	`job_id` varchar(36),
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `resolution_cases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `audit_events` ADD `entity_type` varchar(40);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `request_id` varchar(100);--> statement-breakpoint
ALTER TABLE `audit_events` ADD `reason` text;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `sensitivity` varchar(20) DEFAULT 'General' NOT NULL;--> statement-breakpoint
ALTER TABLE `audit_events` ADD `scope_company_ids` json;--> statement-breakpoint
ALTER TABLE `clause_template_versions` ADD CONSTRAINT `clause_template_versions_clause_id_clause_templates_id_fk` FOREIGN KEY (`clause_id`) REFERENCES `clause_templates`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_profiles` ADD CONSTRAINT `company_profiles_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_relationships` ADD CONSTRAINT `company_relationships_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `company_relationships` ADD CONSTRAINT `company_relationships_person_id_people_id_fk` FOREIGN KEY (`person_id`) REFERENCES `people`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_generations` ADD CONSTRAINT `document_generations_case_id_resolution_cases_id_fk` FOREIGN KEY (`case_id`) REFERENCES `resolution_cases`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `document_generations` ADD CONSTRAINT `document_generations_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `generation_records` ADD CONSTRAINT `generation_records_generation_id_document_generations_id_fk` FOREIGN KEY (`generation_id`) REFERENCES `document_generations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `generation_records` ADD CONSTRAINT `generation_records_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resolution_assembly_versions` ADD CONSTRAINT `assembly_versions_assembly_fk` FOREIGN KEY (`assembly_id`) REFERENCES `resolution_assemblies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resolution_cases` ADD CONSTRAINT `resolution_cases_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `company_relationships_company` ON `company_relationships` (`company_id`,`role`);--> statement-breakpoint
CREATE INDEX `company_relationships_person` ON `company_relationships` (`person_id`);--> statement-breakpoint
CREATE INDEX `document_generations_case` ON `document_generations` (`case_id`);--> statement-breakpoint
CREATE INDEX `document_generations_family` ON `document_generations` (`family_id`);--> statement-breakpoint
CREATE INDEX `generation_records_generation` ON `generation_records` (`generation_id`);--> statement-breakpoint
CREATE INDEX `people_full_name` ON `people` (`full_name`);--> statement-breakpoint
CREATE INDEX `resolution_cases_company` ON `resolution_cases` (`company_id`);--> statement-breakpoint
CREATE INDEX `resolution_cases_job` ON `resolution_cases` (`job_id`);--> statement-breakpoint
CREATE INDEX `audit_events_company_time` ON `audit_events` (`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_time` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_entity` ON `audit_events` (`entity_type`,`subject_id`);--> statement-breakpoint
INSERT INTO `output_types` (`id`, `data`) VALUES ('directors_written', JSON_OBJECT('id','directors_written','name','Directors'' written resolution','body','directors','active',true,'order',1)), ('members_written', JSON_OBJECT('id','members_written','name','Members'' written resolution','body','members','active',true,'order',2));
