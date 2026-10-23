export function hasUnsavedEdits() {
  return Boolean(document.querySelector('[data-dirty="true"]'));
}
export function canLeaveEditing() {
  return !hasUnsavedEdits() || window.confirm('Discard unsaved changes?');
}
