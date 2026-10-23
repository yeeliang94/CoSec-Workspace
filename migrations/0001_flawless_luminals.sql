CREATE TABLE `company_registers` (
	`company_id` varchar(36) NOT NULL,
	`revision` int NOT NULL,
	`data` json NOT NULL,
	CONSTRAINT `company_registers_company_id` PRIMARY KEY(`company_id`)
) ENGINE=InnoDB;
--> statement-breakpoint
ALTER TABLE `company_registers` ADD CONSTRAINT `company_registers_company_id_companies_id_fk` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE no action ON UPDATE no action;