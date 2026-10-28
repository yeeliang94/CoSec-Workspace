import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  templateAction: vi.fn(),
  applyVersionAction: vi.fn(),
  closeDatabase: vi.fn(),
}));
vi.mock('../src/server/db', () => ({
  closeDatabase: mocks.closeDatabase,
  db: { select: () => ({ from: () => ({ where: async () => [{ id: 'seed-user' }] }) }) },
}));
vi.mock('../src/server/repository', () => ({
  getActorById: vi
    .fn()
    .mockResolvedValueOnce({ id: 'author', capabilities: ['manage_templates'] })
    .mockResolvedValueOnce({ id: 'publisher', capabilities: ['manage_templates', 'review_pack'] }),
}));
vi.mock('../src/server/resolution/templates', () => ({
  ...mocks,
  listTemplates: async () =>
    ['Draft', 'Returned', 'In review', 'Published', 'Retired'].map((status) => ({
      id: status,
      name: status,
      versions: [{ id: `version-${status}`, status }],
    })),
}));
vi.mock('../src/server/resolution/samples', () => ({
  SAMPLE_SOURCE: 'Fictional fixture',
  STARTER_CLAUSES: ['Draft', 'Returned', 'In review', 'Published', 'Retired'].map((name) => ({
    key: name,
    name,
  })),
  STARTER_ASSEMBLIES: [{ key: 'assembly', name: 'Draft', content: {}, starterKeys: ['Draft'] }],
}));

it('leaves every existing sample template and staff draft untouched on restart', async () => {
  await import('../scripts/seed-resolution-samples');
  expect(mocks.templateAction).not.toHaveBeenCalled();
  expect(mocks.applyVersionAction).not.toHaveBeenCalled();
  expect(mocks.closeDatabase).toHaveBeenCalled();
});
