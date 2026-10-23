import type { CompanyRegisters } from '../domain/records';
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
export const auditEvents = mysqlTable('audit_events', {
  id: varchar('id', { length: 36 }).primaryKey(),
  actorId: varchar('actor_id', { length: 36 }).notNull(),
  companyId: varchar('company_id', { length: 36 }),
  action: varchar('action', { length: 100 }).notNull(),
  subjectId: varchar('subject_id', { length: 80 }).notNull(),
  detail: json('detail').notNull(),
  createdAt: timestamp('created_at', { fsp: 3 }).notNull(),
});
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
