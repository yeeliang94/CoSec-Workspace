import { z } from 'zod';
import { assertCapability } from '../domain/access';
import type { Actor, Settings } from '../domain/model';
import {
  getSettings,
  listDocuments,
  mutateSettings,
  pruneRequests,
  saveActorPreferences,
} from './repository';

const base = { expectedRevision: z.number().int().positive(), requestId: z.string().uuid() };
const settingsAction = z.object({
  ...base,
  action: z.literal('defaults'),
  firmName: z.string().trim().min(1).max(120),
});
export const preferencesSchema = z
  .object({
    textSize: z.enum(['default', 'large', 'larger']),
    density: z.enum(['comfortable', 'compact']),
    reducedMotion: z.boolean(),
  })
  .strict();
export async function getWorkspaceSupport(actor: Actor) {
  const [documents, settings] = await Promise.all([listDocuments(actor), getSettings()]);
  return {
    documents: documents.map(({ storageKey, ...metadata }) => {
      void storageKey;
      return metadata;
    }),
    settings,
  };
}

export async function applySettingsAction(actor: Actor, input: unknown) {
  assertCapability(actor, 'manage_catalogue');
  const action = settingsAction.parse(input);
  return mutateSettings(actor, action.expectedRevision, action.requestId, (settings: Settings) => ({
    ...settings,
    firmName: action.firmName,
  }));
}

export async function savePreferences(actor: Actor, input: unknown) {
  const preferences = preferencesSchema.parse(input);
  await saveActorPreferences(actor, preferences);
  return preferences;
}

const REQUEST_RETENTION_DAYS = 30;
/** Duplicate-submission records only need to outlive client retries; audit events are kept separately. */
export function pruneRequestRecords() {
  return pruneRequests(REQUEST_RETENTION_DAYS);
}
