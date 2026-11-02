import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Actor, Settings } from '../src/domain/model';
import { defaultPreferences, defaultSettings } from '../src/domain/model';
const mock = vi.hoisted(() => ({
  settings: null as unknown,
  save: vi.fn(),
}));
vi.mock('../src/server/repository', () => ({
  getSettings: async () => mock.settings,
  mutateSettings: async (
    _actor: unknown,
    expected: number,
    _requestId: string,
    fn: (settings: unknown) => unknown,
  ) => {
    const current = mock.settings as Settings;
    if (current.revision !== expected) throw new Error('Stale settings');
    mock.settings = await fn(structuredClone(current));
    (mock.settings as Settings).revision = current.revision + 1;
    return mock.settings;
  },
  saveActorPreferences: mock.save,
  pruneRequests: async () => 0,
  listDocuments: async () => [],
}));
import { applySettingsAction, preferencesSchema, savePreferences } from '../src/server/support';
const actor: Actor = {
  id: 'admin',
  name: 'Admin',
  email: 'admin@example.test',
  capabilities: ['manage_catalogue'],
  companyIds: ['company'],
  preferences: defaultPreferences,
};
const requestId = () => crypto.randomUUID();
beforeEach(() => {
  mock.settings = structuredClone(defaultSettings);
  mock.save.mockReset();
});
describe('controlled settings', () => {
  it('saves the firm name and never changes the self approval policy', async () => {
    const result = await applySettingsAction(actor, {
      action: 'defaults',
      expectedRevision: 1,
      requestId: requestId(),
      firmName: 'Example Firm',
      selfApproval: true,
    });
    expect(result.firmName).toBe('Example Firm');
    expect(result.selfApproval).toBe(false);
    expect(result.revision).toBe(2);
  });
  it('requires firm settings permission', async () => {
    await expect(
      applySettingsAction(
        { ...actor, capabilities: ['prepare_job'] },
        { action: 'defaults', expectedRevision: 1, requestId: requestId(), firmName: 'Example' },
      ),
    ).rejects.toThrow('permission');
    expect((mock.settings as Settings).revision).toBe(1);
  });
  it('never permits document formatting through personal preferences', async () => {
    expect(() =>
      preferencesSchema.parse({ ...defaultPreferences, documentFontSize: 18 }),
    ).toThrow();
    await savePreferences(actor, { textSize: 'larger', density: 'compact', reducedMotion: true });
    expect(mock.save).toHaveBeenCalledWith(actor, {
      textSize: 'larger',
      density: 'compact',
      reducedMotion: true,
    });
  });
});
