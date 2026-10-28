import { DomainError } from '../access';
import type {
  CaseKind,
  CaseStep,
  DecisionRecord,
  ResolutionCase,
  StepKind,
  StepState,
} from './model';

export const MAX_STEPS = 50;
/** The step checks only that the linked W04 job posted its record event; filing is tracked on the job. */
export const REGISTRATION_LABEL = 'Record posting through W04';
const DONE: StepState[] = ['Complete', 'Not applicable'];
export const isDone = (step: CaseStep) => DONE.includes(step.state);

export function defaultSteps(kind: CaseKind, ownerId: string, newId: () => string): CaseStep[] {
  const plan: [StepKind, string][] = [
    ['instruction', 'Instruction received'],
    ['preparation', 'Prepare resolution'],
    ['review', 'Review generated resolution'],
    ['execution', 'Circulate and record execution'],
  ];
  if (kind !== 'board') plan.push(['registration', REGISTRATION_LABEL]);
  const steps: CaseStep[] = [];
  for (const [stepKind, label] of plan)
    steps.push({
      id: newId(),
      kind: stepKind,
      label,
      ownerId,
      state: 'Pending',
      reason: null,
      dueDate: null,
      completedAt: null,
      dependsOn: steps.length ? [steps[steps.length - 1].id] : [],
      evidenceIds: [],
    });
  return steps;
}

export const emptyDecision = (): DecisionRecord => ({
  status: 'Not recorded',
  date: null,
  evidenceIds: [],
  actorId: null,
  note: '',
});

/** Rejects unknown or self dependencies and any cycle (depth-first search over all steps). */
export function validateDependencies(steps: CaseStep[]) {
  const byId = new Map(steps.map((s) => [s.id, s]));
  if (byId.size !== steps.length) throw new DomainError('Step ids must be unique.');
  for (const step of steps)
    for (const dep of step.dependsOn) {
      if (dep === step.id) throw new DomainError(`"${step.label}" cannot depend on itself.`);
      if (!byId.has(dep)) throw new DomainError(`"${step.label}" depends on an unknown step.`);
    }
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (step: CaseStep, path: string[]) => {
    if (state.get(step.id) === 'done') return;
    if (state.get(step.id) === 'visiting')
      throw new DomainError(
        `Step dependencies form a cycle: ${[...path, step.label].join(' → ')}.`,
      );
    state.set(step.id, 'visiting');
    for (const dep of step.dependsOn) visit(byId.get(dep)!, [...path, step.label]);
    state.set(step.id, 'done');
  };
  for (const step of steps) visit(step, []);
}

export type StepPatch = {
  label?: string;
  state?: StepState;
  ownerId?: string;
  dueDate?: string | null;
  reason?: string | null;
  evidenceIds?: string[];
  dependsOn?: string[];
};
/**
 * Applies one step change. `recordEventId` is the linked W04 job's posted record event: the
 * registration step only records that posting happened through W04 and never posts itself.
 */
export function updateStep(
  resolutionCase: ResolutionCase,
  stepId: string,
  patch: StepPatch,
  context: { recordEventId: string | null; now: string },
): CaseStep {
  assertOpen(resolutionCase);
  const step = resolutionCase.steps.find((s) => s.id === stepId);
  if (!step) throw new DomainError('Choose an existing step.', 'NOT_FOUND', 404);
  if (patch.label !== undefined) {
    if (step.kind === 'registration')
      throw new DomainError('The registration step label is fixed.');
    step.label = patch.label.trim();
  }
  if (patch.ownerId !== undefined) step.ownerId = patch.ownerId;
  if (patch.dueDate !== undefined) step.dueDate = patch.dueDate;
  if (patch.evidenceIds !== undefined) step.evidenceIds = patch.evidenceIds;
  if (patch.reason !== undefined) step.reason = patch.reason?.trim() || null;
  if (patch.dependsOn !== undefined) {
    step.dependsOn = [...new Set(patch.dependsOn)];
    validateDependencies(resolutionCase.steps);
  }
  const target = patch.state ?? step.state;
  if (target === 'Not applicable') {
    if (step.kind === 'registration')
      throw new DomainError(
        'Registration cannot be marked not applicable. Cancel the case if the director change will not proceed.',
      );
    if (!step.reason) throw new DomainError('Give a reason for marking this step not applicable.');
  }
  if (DONE.includes(target)) {
    const blocking = step.dependsOn
      .map((id) => resolutionCase.steps.find((s) => s.id === id)!)
      .filter((dep) => !isDone(dep));
    if (blocking.length)
      throw new DomainError(
        `Complete ${blocking.map((d) => `"${d.label}"`).join(', ')} before "${step.label}".`,
      );
  }
  if (target === 'Complete' && step.kind === 'registration') {
    if (!resolutionCase.jobId)
      throw new DomainError('Link the W04 director-change job before completing registration.');
    if (!context.recordEventId)
      throw new DomainError(
        'The linked W04 job has not posted its reviewed record event. Post it through W04 first.',
      );
  }
  if (!DONE.includes(target) && isDone(step)) {
    const dependents = resolutionCase.steps.filter(
      (s) => s.dependsOn.includes(step.id) && isDone(s),
    );
    if (dependents.length)
      throw new DomainError(
        `Reopen ${dependents.map((d) => `"${d.label}"`).join(', ')} before reopening "${step.label}".`,
      );
  }
  if (target !== step.state) step.completedAt = target === 'Complete' ? context.now : null;
  step.state = target;
  return step;
}

export function assertOpen(resolutionCase: ResolutionCase) {
  if (resolutionCase.state !== 'Open')
    throw new DomainError(`This case is ${resolutionCase.state.toLowerCase()} and cannot change.`);
}

export function assertCompletable(resolutionCase: ResolutionCase) {
  assertOpen(resolutionCase);
}

/** Drafting is paused while a reviewer has the resolution, and after approval. */
export function isEditable(resolutionCase: ResolutionCase) {
  return (
    resolutionCase.state === 'Open' &&
    resolutionCase.review?.status !== 'With reviewer' &&
    resolutionCase.review?.status !== 'Approved'
  );
}
export function assertEditable(resolutionCase: ResolutionCase) {
  assertOpen(resolutionCase);
  if (!isEditable(resolutionCase))
    throw new DomainError(
      resolutionCase.review?.status === 'Approved'
        ? 'This resolution is approved. Reopen it to make changes.'
        : 'This resolution is with a reviewer. Take it back to make changes.',
      'CONFLICT',
      409,
    );
}

/** Plain status for lists and headings. */
export function caseStatus(resolutionCase: ResolutionCase, userName: (id: string) => string) {
  if (resolutionCase.state !== 'Open') return resolutionCase.state;
  const review = resolutionCase.review;
  if (!review) return 'Draft';
  if (review.status === 'With reviewer') return `With ${userName(review.reviewerId)} for review`;
  if (review.status === 'Returned') return `Returned by ${userName(review.reviewerId)}`;
  return `Approved by ${userName(review.reviewerId)}`;
}

/** Route of the W04 job a case kind may link to; a board case may link to any W04 job. */
export function routeMatches(kind: CaseKind, route: string | null) {
  if (kind === 'director_appointment') return route === 'appointment';
  if (kind === 'director_resignation') return route === 'resignation';
  return true;
}
