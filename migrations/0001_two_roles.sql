-- Accounts move to two roles: Admin (anyone who could manage users) and User.
UPDATE "user" SET capabilities = '["prepare_job","review_pack","confirm_record","record_filing","view_bo","manage_people","generate_documents","view_audit","manage_catalogue","manage_users","manage_templates","export_audit"]' WHERE capabilities LIKE '%"manage_users"%';
--> statement-breakpoint
UPDATE "user" SET capabilities = '["prepare_job","review_pack","confirm_record","record_filing","view_bo","manage_people","generate_documents","view_audit"]' WHERE capabilities NOT LIKE '%"manage_users"%';
