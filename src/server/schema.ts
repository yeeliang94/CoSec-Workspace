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
import {
  mysqlTable,
  varchar,
  text,
  timestamp,
  boolean,
  int,
  json,
  uniqueIndex,
  index,
  foreignKey,
} from 'drizzle-orm/mysql-core';
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
export const user = mysqlTable('user', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
  capabilities: json('capabilities')
    .$type<Capability[]>()
    .notNull()
    .$defaultFn(() => []),
  companyIds: json('company_ids')
    .$type<string[]>()
    .notNull()
    .$defaultFn(() => []),
  preferences: json('preferences')
    .$type<Preferences>()
    .notNull()
    .$defaultFn(() => defaultPreferences),
  active: boolean('active').notNull().default(true),
});
export const session = mysqlTable('session', {
  id: varchar('id', { length: 36 }).primaryKey(),
  expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
  token: varchar('token', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
});
export const account = mysqlTable('account', {
  id: varchar('id', { length: 36 }).primaryKey(),
  accountId: varchar('account_id', { length: 255 }).notNull(),
  providerId: varchar('provider_id', { length: 255 }).notNull(),
  userId: varchar('user_id', { length: 36 })
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { fsp: 3 }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { fsp: 3 }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
  updatedAt: timestamp('updated_at', { fsp: 3 }).notNull(),
});
export const verification = mysqlTable('verification', {
  id: varchar('id', { length: 36 }).primaryKey(),
  identifier: varchar('identifier', { length: 255 }).notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { fsp: 3 }).notNull(),
  createdAt: timestamp('created_at', { fsp: 3 }),
  updatedAt: timestamp('updated_at', { fsp: 3 }),
});
export const companies = mysqlTable('companies', {
  id: varchar('id', { length: 36 }).primaryKey(),
  data: json('data').$type<Company>().notNull(),
});
export const jobs = mysqlTable(
  'jobs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    companyId: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    periodKey: varchar('period_key', { length: 80 }),
    revision: int('revision').notNull(),
    data: json('data').$type<Job>().notNull(),
  },
  (t) => [uniqueIndex('jobs_period_unique').on(t.periodKey)],
);
export const officerEvents = mysqlTable('officer_events', {
  id: varchar('id', { length: 36 }).primaryKey(),
  companyId: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companies.id),
  data: json('data').$type<OfficerEvent>().notNull(),
});
export const documents = mysqlTable('documents', {
  id: varchar('id', { length: 36 }).primaryKey(),
  companyId: varchar('company_id', { length: 36 })
    .notNull()
    .references(() => companies.id),
  data: json('data').$type<Document>().notNull(),
});
export const settings = mysqlTable('settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  revision: int('revision').notNull(),
  data: json('data').$type<Settings>().notNull(),
});
export const reminders = mysqlTable(
  'reminders',
  {
    id: varchar('id', { length: 180 }).primaryKey(),
    companyId: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    resolved: boolean('resolved').notNull().default(false),
    data: json('data').$type<Reminder>().notNull(),
  },
  (t) => [index('reminders_open_by_company').on(t.companyId, t.resolved)],
);
export const auditEvents = mysqlTable(
  'audit_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    actorId: varchar('actor_id', { length: 36 }).notNull(),
    companyId: varchar('company_id', { length: 36 }),
    action: varchar('action', { length: 100 }).notNull(),
    subjectId: varchar('subject_id', { length: 80 }).notNull(),
    detail: json('detail').notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
    entityType: varchar('entity_type', { length: 40 }),
    requestId: varchar('request_id', { length: 100 }),
    reason: text('reason'),
    sensitivity: varchar('sensitivity', { length: 20 }).notNull().default('General'),
    /** Companies whose staff may read the entry, fixed at the time of change. */
    scopeCompanyIds: json('scope_company_ids').$type<string[]>(),
  },
  (t) => [
    index('audit_events_company_time').on(t.companyId, t.createdAt),
    index('audit_events_time').on(t.createdAt),
    index('audit_events_entity').on(t.entityType, t.subjectId),
  ],
);
export const requests = mysqlTable(
  'mutation_requests',
  {
    id: varchar('id', { length: 180 }).primaryKey(),
    result: json('result').notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [index('mutation_requests_created_at').on(t.createdAt)],
);

export const companyRegisters = mysqlTable('company_registers', {
  companyId: varchar('company_id', { length: 36 })
    .primaryKey()
    .references(() => companies.id),
  revision: int('revision').notNull(),
  data: json('data').$type<CompanyRegisters>().notNull(),
});

// ---------------------------------------------------------------- resolution builder (0003)
export const people = mysqlTable(
  'people',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    revision: int('revision').notNull(),
    data: json('data').$type<Person>().notNull(),
  },
  (t) => [index('people_full_name').on(t.fullName)],
);
export const companyRelationships = mysqlTable(
  'company_relationships',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    companyId: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    personId: varchar('person_id', { length: 64 })
      .notNull()
      .references(() => people.id),
    role: varchar('role', { length: 20 }).notNull(),
    revision: int('revision').notNull(),
    data: json('data').$type<CompanyRelationship>().notNull(),
  },
  (t) => [
    index('company_relationships_company').on(t.companyId, t.role),
    index('company_relationships_person').on(t.personId),
  ],
);
export const companyProfiles = mysqlTable('company_profiles', {
  companyId: varchar('company_id', { length: 36 })
    .primaryKey()
    .references(() => companies.id),
  revision: int('revision').notNull(),
  data: json('data').$type<CompanyProfile>().notNull(),
});
export const recordFieldDefinitions = mysqlTable('record_field_definitions', {
  id: varchar('id', { length: 64 }).primaryKey(),
  scope: varchar('scope', { length: 20 }).notNull(),
  revision: int('revision').notNull(),
  data: json('data').$type<RecordFieldDefinition>().notNull(),
});
export const resolutionCases = mysqlTable(
  'resolution_cases',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    companyId: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    jobId: varchar('job_id', { length: 36 }),
    revision: int('revision').notNull(),
    data: json('data').$type<ResolutionCase>().notNull(),
  },
  (t) => [
    index('resolution_cases_company').on(t.companyId),
    index('resolution_cases_job').on(t.jobId),
  ],
);
export const outputTypes = mysqlTable('output_types', {
  id: varchar('id', { length: 64 }).primaryKey(),
  data: json('data').$type<OutputType>().notNull(),
});
export const clauseTemplates = mysqlTable('clause_templates', {
  id: varchar('id', { length: 36 }).primaryKey(),
  revision: int('revision').notNull(),
  data: json('data').$type<ClauseTemplate>().notNull(),
});
export const clauseTemplateVersions = mysqlTable(
  'clause_template_versions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    clauseId: varchar('clause_id', { length: 36 })
      .notNull()
      .references(() => clauseTemplates.id),
    version: int('version').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    revision: int('revision').notNull(),
    data: json('data').$type<ClauseVersion>().notNull(),
  },
  (t) => [uniqueIndex('clause_versions_unique').on(t.clauseId, t.version)],
);
export const resolutionAssemblies = mysqlTable('resolution_assemblies', {
  id: varchar('id', { length: 36 }).primaryKey(),
  revision: int('revision').notNull(),
  data: json('data').$type<ResolutionAssembly>().notNull(),
});
export const resolutionAssemblyVersions = mysqlTable(
  'resolution_assembly_versions',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    assemblyId: varchar('assembly_id', { length: 36 }).notNull(),
    version: int('version').notNull(),
    status: varchar('status', { length: 20 }).notNull(),
    revision: int('revision').notNull(),
    data: json('data').$type<AssemblyVersion>().notNull(),
  },
  (t) => [
    uniqueIndex('assembly_versions_unique').on(t.assemblyId, t.version),
    // MySQL identifiers are limited to 64 characters, so this key is named explicitly.
    foreignKey({
      name: 'assembly_versions_assembly_fk',
      columns: [t.assemblyId],
      foreignColumns: [resolutionAssemblies.id],
    }),
  ],
);
export const documentGenerations = mysqlTable(
  'document_generations',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    familyId: varchar('family_id', { length: 36 }).notNull(),
    caseId: varchar('case_id', { length: 36 })
      .notNull()
      .references(() => resolutionCases.id),
    companyId: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    status: varchar('status', { length: 20 }).notNull(),
    /** actor:operation:requestId; same key + same payload returns the original generation. */
    requestKey: varchar('request_key', { length: 180 }).notNull(),
    data: json('data').$type<DocumentGeneration>().notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [
    uniqueIndex('document_generations_request').on(t.requestKey),
    index('document_generations_case').on(t.caseId),
    index('document_generations_family').on(t.familyId),
  ],
);
export const generationRecords = mysqlTable(
  'generation_records',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    generationId: varchar('generation_id', { length: 36 })
      .notNull()
      .references(() => documentGenerations.id),
    companyId: varchar('company_id', { length: 36 })
      .notNull()
      .references(() => companies.id),
    kind: varchar('kind', { length: 20 }).notNull(),
    data: json('data').$type<GenerationRecord>().notNull(),
    createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
  },
  (t) => [index('generation_records_generation').on(t.generationId)],
);
