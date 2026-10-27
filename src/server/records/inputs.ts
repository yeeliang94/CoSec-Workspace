import { z } from 'zod';
import { CITATION_KEYS } from '../../domain/resolution/model';
import { isCalendarDate } from '../../domain/resolution/records';

/** Zod request schemas for the records routes. */
export const recordId = z.string().min(1).max(100);
export const date = z.string().refine(isCalendarDate, 'Enter a calendar date (YYYY-MM-DD).');
const optionalDate = date.nullable().optional();
const requestId = z.string().uuid();
const expectedRevision = z.number().int().min(0);
const reason = z.string().trim().min(1).max(2000);
const name = z.string().trim().min(1).max(255);
const evidenceIds = z.array(recordId).max(50);
const fieldValue = z.union([z.string().max(4000), z.boolean(), z.null()]);
const mutation = { requestId, expectedRevision };

export const personInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    requestId,
    fullName: name,
    email: z.email().max(255).nullable().optional(),
    notes: z.string().max(4000).optional(),
  }),
  z.object({
    action: z.literal('update'),
    id: recordId,
    ...mutation,
    fullName: name.optional(),
    email: z.email().max(255).nullable().optional(),
    notes: z.string().max(4000).optional(),
    reason,
  }),
  z.object({
    action: z.literal('set_custom'),
    id: recordId,
    ...mutation,
    definitionId: recordId,
    value: fieldValue,
    effectiveDate: date,
    reason,
  }),
]);

export const relationshipInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('add'),
    requestId,
    personId: recordId,
    role: z.enum(['member', 'secretary', 'auditor', 'other']),
    capacity: z.string().trim().max(200).default(''),
    startDate: date.nullable(),
    evidenceIds: evidenceIds.default([]),
  }),
  z.object({ action: z.literal('end'), id: recordId, ...mutation, endDate: date, reason }),
  z.object({
    action: z.literal('set_capacity'),
    id: recordId,
    ...mutation,
    capacity: z.string().trim().max(200),
    reason,
  }),
]);

export const profileInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set_citation'),
    ...mutation,
    key: z.enum(CITATION_KEYS),
    value: z.string().trim().min(1).max(2000),
    effectiveDate: date,
    reason,
  }),
  z.object({
    action: z.literal('set_custom'),
    ...mutation,
    definitionId: recordId,
    value: fieldValue,
    effectiveDate: date,
    reason,
  }),
]);

const option = z.object({
  id: z.string().min(1).max(64),
  label: z.string().trim().min(1).max(200),
});
export const fieldDefinitionInput = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    requestId,
    id: z.string().min(2).max(64),
    scope: z.enum(['company', 'person', 'case']),
    label: name,
    valueType: z.enum(['text', 'date', 'number', 'boolean', 'choice']),
    options: z.array(option).max(100).optional(),
  }),
  z.object({
    action: z.literal('update'),
    id: recordId,
    ...mutation,
    label: name.optional(),
    options: z.array(option).max(100).optional(),
    reason,
  }),
  z.object({ action: z.literal('archive'), id: recordId, ...mutation, reason }),
]);

export const createCaseInput = z.object({
  requestId,
  companyId: recordId,
  kind: z.enum(['board', 'director_appointment', 'director_resignation']),
  title: z.string().trim().min(1).max(300),
  jobId: recordId.nullable().optional(),
  personId: recordId.nullable().optional(),
  instructionDate: optionalDate,
  resolutionDate: optionalDate,
  effectiveDate: optionalDate,
});

const stepKind = z.enum(['instruction', 'preparation', 'review', 'execution', 'custom']);
const stepState = z.enum(['Pending', 'In progress', 'Waiting', 'Complete', 'Not applicable']);
export const caseActionInput = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link_job'), ...mutation, jobId: recordId }),
  z.object({
    action: z.literal('update_details'),
    ...mutation,
    title: z.string().trim().min(1).max(300).optional(),
    instructionDate: optionalDate,
    resolutionDate: optionalDate,
    effectiveDate: optionalDate,
    ownerId: recordId.optional(),
    personId: recordId.nullable().optional(),
  }),
  z.object({
    action: z.literal('add_step'),
    ...mutation,
    kind: stepKind.default('custom'),
    label: z.string().trim().min(1).max(200),
    ownerId: recordId.optional(),
    dueDate: optionalDate,
    dependsOn: z.array(recordId).max(50).optional(),
  }),
  z.object({
    action: z.literal('update_step'),
    ...mutation,
    stepId: recordId,
    label: z.string().trim().min(1).max(200).optional(),
    state: stepState.optional(),
    ownerId: recordId.optional(),
    dueDate: optionalDate,
    reason: z.string().trim().max(2000).nullable().optional(),
    evidenceIds: evidenceIds.optional(),
    dependsOn: z.array(recordId).max(50).optional(),
  }),
  z.object({
    action: z.literal('record_decision'),
    ...mutation,
    status: z.enum(['Not recorded', 'Passed', 'Not passed']),
    date: date.nullable(),
    evidenceIds: evidenceIds.default([]),
    note: z.string().max(4000).optional(),
  }),
  z.object({ action: z.literal('cancel'), ...mutation, reason }),
  z.object({ action: z.literal('complete'), ...mutation }),
  z.object({
    action: z.literal('set_custom'),
    ...mutation,
    definitionId: recordId,
    value: fieldValue,
    effectiveDate: date,
    reason,
  }),
]);

const filterText = z.string().trim().min(1).max(100).optional();
export const auditFilterInput = z.object({
  companyId: filterText,
  entityType: filterText,
  entityId: filterText,
  action: filterText,
  actorId: filterText,
  from: date.optional(),
  to: date.optional(),
});
/** Query-string params with empty values dropped. */
export function searchParams(request: Request) {
  return Object.fromEntries(
    [...new URL(request.url).searchParams.entries()].filter(([, v]) => v.trim() !== ''),
  );
}
