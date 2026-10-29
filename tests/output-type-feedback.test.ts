import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OutputTypes } from '../src/components/template-library/output-types';

vi.mock('../src/components/resolution/use-action', async (original) => ({
  ...(await original<typeof import('../src/components/resolution/use-action')>()),
  useAction: () => ({ error: 'Network unavailable', status: '', pending: false, run: vi.fn() }),
}));

describe('document type feedback', () => {
  it('keeps creation errors inside the modal rather than the inert background', () => {
    const html = renderToStaticMarkup(
      createElement(OutputTypes, {
        types: [],
        creating: true,
        onCreating: vi.fn(),
        reload: async () => {},
      }),
    );
    const dialog = html.match(/<dialog\b[^>]*>([\s\S]*?)<\/dialog>/)?.[1];
    expect(dialog).toContain('role="alert"');
    expect(dialog).toContain('Network unavailable');
    expect(html.match(/Network unavailable/g)).toHaveLength(1);
  });
});
