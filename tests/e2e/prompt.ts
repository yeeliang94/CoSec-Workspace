import { expect, type Page } from '@playwright/test';

/** Answers the in-app confirmation dialog (it replaced window.confirm). */
export async function answerPrompt(
  page: Page,
  accept: boolean,
  { message = 'Discard unsaved changes?', confirmLabel = 'Discard changes' } = {},
) {
  const dialog = page.getByRole('alertdialog', { name: message });
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('button', { name: accept ? confirmLabel : 'Keep editing', exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
