import type { CompanyRegisters } from '../domain/records';
import type {
  AssemblyVersion,
  ClauseTemplate,
  ClauseVersion,
  CompanyProfile,
  CompanyRelationship,
  DocumentGeneration,
  GenerationRecord,
  OutputType,
  Person,
  RecordFieldDefinition,
  ResolutionAssembly,
  ResolutionCase,
} from '../domain/resolution/model';
import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
  index,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { defaultPreferences } from '../domain/model';
import type {
  Capability,
  Preferences,
  Company,
  Job,
  Document,
  OfficerEvent,
  Settings,
  Reminder,
} from '../domain/model';
export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    capabilities: text('capabilities', { mode: 'json' })
      .$type<Capability[]>()
      .notNull()
      .$defaultFn(() => []),
    companyIds: text('company_ids', { mode: 'json' })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    preferences: text('preferences', { mode: 'json' })
      .$type<Preferences>()
      .notNull()
      .$defaultFn(() => defaultPreferences),
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  // MySQL's default collation ignored case; keep one account per address regardless of case.
  (t) => [uniqueIndex('user_email_unique').on(sql`lower(${t.email})`)],
);
export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});
export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});
export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});
export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  data: text('data', { mode: 'json' }).$type<Company>().notNull(),
});
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    periodKey: text('period_key'),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<Job>().notNull(),
  },
  (t) => [uniqueIndex('jobs_period_unique').on(t.periodKey)],
);
export const officerEvents = sqliteTable('officer_events', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  data: text('data', { mode: 'json' }).$type<OfficerEvent>().notNull(),
});
export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  companyId: text('company_id')
    .notNull()
    .references(() => companies.id),
  data: text('data', { mode: 'json' }).$type<Document>().notNull(),
});
export const settings = sqliteTable('settings', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<Settings>().notNull(),
});
export const reminders = sqliteTable(
  'reminders',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
    data: text('data', { mode: 'json' }).$type<Reminder>().notNull(),
  },
  (t) => [index('reminders_open_by_company').on(t.companyId, t.resolved)],
);
export const auditEvents = sqliteTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id').notNull(),
    companyId: text('company_id'),
    action: text('action').notNull(),
    subjectId: text('subject_id').notNull(),
    detail: text('detail', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    entityType: text('entity_type'),
    requestId: text('request_id'),
    reason: text('reason'),
    sensitivity: text('sensitivity').notNull().default('General'),
    /** Companies whose staff may read the entry, fixed at the time of change. */
    scopeCompanyIds: text('scope_company_ids', { mode: 'json' }).$type<string[]>(),
  },
  (t) => [
    index('audit_events_company_time').on(t.companyId, t.createdAt),
    index('audit_events_time').on(t.createdAt),
    index('audit_events_entity').on(t.entityType, t.subjectId),
  ],
);
export const requests = sqliteTable(
  'mutation_requests',
  {
    id: text('id').primaryKey(),
    result: text('result', { mode: 'json' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('mutation_requests_created_at').on(t.createdAt)],
);

export const companyRegisters = sqliteTable('company_registers', {
  companyId: text('company_id')
    .primaryKey()
    .references(() => companies.id),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<CompanyRegisters>().notNull(),
});

// ---------------------------------------------------------------- resolution builder (0003)
export const people = sqliteTable(
  'people',
  {
    id: text('id').primaryKey(),
    fullName: text('full_name').notNull(),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<Person>().notNull(),
  },
  (t) => [index('people_full_name').on(t.fullName)],
);
export const companyRelationships = sqliteTable(
  'company_relationships',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    role: text('role').notNull(),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<CompanyRelationship>().notNull(),
  },
  (t) => [
    index('company_relationships_company').on(t.companyId, t.role),
    index('company_relationships_person').on(t.personId),
  ],
);
export const companyProfiles = sqliteTable('company_profiles', {
  companyId: text('company_id')
    .primaryKey()
    .references(() => companies.id),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<CompanyProfile>().notNull(),
});
export const recordFieldDefinitions = sqliteTable('record_field_definitions', {
  id: text('id').primaryKey(),
  scope: text('scope').notNull(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<RecordFieldDefinition>().notNull(),
});
export const resolutionCases = sqliteTable(
  'resolution_cases',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    jobId: text('job_id'),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<ResolutionCase>().notNull(),
  },
  (t) => [
    index('resolution_cases_company').on(t.companyId),
    index('resolution_cases_job').on(t.jobId),
  ],
);
export const outputTypes = sqliteTable('output_types', {
  id: text('id').primaryKey(),
  data: text('data', { mode: 'json' }).$type<OutputType>().notNull(),
});
export const clauseTemplates = sqliteTable('clause_templates', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<ClauseTemplate>().notNull(),
});
export const clauseTemplateVersions = sqliteTable(
  'clause_template_versions',
  {
    id: text('id').primaryKey(),
    clauseId: text('clause_id')
      .notNull()
      .references(() => clauseTemplates.id),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<ClauseVersion>().notNull(),
  },
  (t) => [uniqueIndex('clause_versions_unique').on(t.clauseId, t.version)],
);
export const resolutionAssemblies = sqliteTable('resolution_assemblies', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  data: text('data', { mode: 'json' }).$type<ResolutionAssembly>().notNull(),
});
export const resolutionAssemblyVersions = sqliteTable(
  'resolution_assembly_versions',
  {
    id: text('id').primaryKey(),
    assemblyId: text('assembly_id').notNull(),
    version: integer('version').notNull(),
    status: text('status').notNull(),
    revision: integer('revision').notNull(),
    data: text('data', { mode: 'json' }).$type<AssemblyVersion>().notNull(),
  },
  (t) => [
    uniqueIndex('assembly_versions_unique').on(t.assemblyId, t.version),
    foreignKey({
      name: 'assembly_versions_assembly_fk',
      columns: [t.assemblyId],
      foreignColumns: [resolutionAssemblies.id],
    }),
  ],
);
export const documentGenerations = sqliteTable(
  'document_generations',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    caseId: text('case_id')
      .notNull()
      .references(() => resolutionCases.id),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    status: text('status').notNull(),
    /** actor:operation:requestId; same key + same payload returns the original generation. */
    requestKey: text('request_key').notNull(),
    data: text('data', { mode: 'json' }).$type<DocumentGeneration>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('document_generations_request').on(t.requestKey),
    index('document_generations_case').on(t.caseId),
    index('document_generations_family').on(t.familyId),
  ],
);
export const generationRecords = sqliteTable(
  'generation_records',
  {
    id: text('id').primaryKey(),
    generationId: text('generation_id')
      .notNull()
      .references(() => documentGenerations.id),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id),
    kind: text('kind').notNull(),
    data: text('data', { mode: 'json' }).$type<GenerationRecord>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('generation_records_generation').on(t.generationId)],
);
