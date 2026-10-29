type ChoiceField = { name: string; label: string; type?: string; required?: boolean };

/** Checkbox groups need an at-least-one rule; requiring every checkbox would require all items. */
export function requiredChoiceError(fields: readonly ChoiceField[], values: FormData): string {
  const missing = fields.find(
    (field) =>
      field.type === 'multi' &&
      field.required &&
      !values.getAll(field.name).some((value) => typeof value === 'string' && value.trim()),
  );
  return missing ? `Choose at least one item for “${missing.label}”.` : '';
}
