import { applyRecordCommand, recordActionSchemas } from '../record-actions';
import { caseworkActions } from './casework';
import { filingActions } from './filing';
import { packActions } from './pack';
import { reviewActions } from './review';
import { action, type JobAction } from './shared';

const recordActions = Object.fromEntries(
  Object.keys(recordActionSchemas).map((name) => [
    name,
    action({
      preservedAfterSubmission: true,
      run: ({ actor, job, input, tx }) => applyRecordCommand(actor, job, name, input, tx),
    }),
  ]),
);

export const jobActions: Record<string, JobAction> = {
  ...recordActions,
  ...packActions,
  ...reviewActions,
  ...filingActions,
  ...caseworkActions,
};
