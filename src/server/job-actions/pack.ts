import { z } from 'zod';
import { today } from '../../domain/access';
import { approved, currentPack, executionBlockers, officersAt } from '../../domain/workflows';
import { appendVersion } from '../pack-versions';
import { memberSnapshot } from '../record-store';
import * as repo from '../repository';
import { action, calendarDate, evidence, fail, id, independent, text } from './shared';

export const packActions = {
  revise_pack: action({
    schema: z.object({
      notes: z.string().max(20000),
      documentIds: z.array(id).max(100),
      requiredSigners: z.array(z.string().trim().min(1).max(200)).max(30).optional(),
      templateVersionId: id.nullable().optional(),
    }),
    preparer: true,
    preservedAfterSubmission: true,
    async run({ actor, job, tx }, data) {
      await evidence(tx, actor, job.companyId, data.documentIds);
      if (data.templateVersionId) {
        const settings = await repo.getSettings(tx),
          template = settings.catalogue.find(
            (c) =>
              c.id === data.templateVersionId && c.kind === 'template' && c.status === 'Published',
          );
        if (!template || !template.effectiveDate || template.effectiveDate > today())
          fail('Select a published internal template version effective on or before today.');
      }
      if (job.activity === 'W03') {
        job.clientConfirmed = false;
        job.clientConfirmationEvidenceId = null;
      }
      appendVersion(job, actor, {
        checklist: currentPack(job).checklist.map((item) =>
          job.activity === 'W03' && item.id === 'client'
            ? { ...item, evidenceIds: [], notApplicable: undefined }
            : item,
        ),
        notes: data.notes,
        documentIds: [...new Set(data.documentIds)],
        requiredSigners: [...new Set(data.requiredSigners ?? currentPack(job).requiredSigners)],
        templateVersionId: data.templateVersionId ?? currentPack(job).templateVersionId,
      });
      return `Created pack v${currentPack(job).version}; previous version decisions retained.`;
    },
  }),
  checklist_evidence: action({
    schema: z.object({ itemId: id, evidenceIds: z.array(id).min(1).max(100) }),
    preparer: true,
    preservedAfterSubmission: true,
    async run({ actor, job, tx }, data) {
      await evidence(tx, actor, job.companyId, data.evidenceIds);
      const items = structuredClone(currentPack(job).checklist),
        item = items.find((i) => i.id === data.itemId);
      if (!item) fail('Checklist item is unavailable.');
      item.evidenceIds = [...new Set(data.evidenceIds)];
      delete item.notApplicable;
      appendVersion(job, actor, { checklist: items });
      if (job.activity === 'W04' && data.itemId === 'source')
        job.sourceEvidenceIds = [...new Set([...job.sourceEvidenceIds, ...data.evidenceIds])];
      return `Updated ${item.label}; pack v${currentPack(job).version}.`;
    },
  }),
  checklist_na: action({
    schema: z.object({ itemId: id, reason: text, evidenceIds: z.array(id).min(1) }),
    preservedAfterSubmission: true,
    async run({ actor, job, tx }, data) {
      independent(actor, job, 'pack');
      await evidence(tx, actor, job.companyId, data.evidenceIds);
      const items = structuredClone(currentPack(job).checklist),
        item = items.find((i) => i.id === data.itemId);
      if (!item) fail('Checklist item is unavailable.');
      if (
        ['source', 'consent', 'authority', 'route', 'particulars', 'client', 'validation'].includes(
          item.id,
        ) ||
        item.id.startsWith('capital_') ||
        item.id.startsWith('bo_')
      )
        fail('This mandatory evidence requirement cannot be waived.');
      item.notApplicable = {
        reason: data.reason,
        reviewerId: actor.id,
        evidenceIds: data.evidenceIds,
      };
      appendVersion(job, actor, { checklist: items });
      return `Not applicable: ${item.label}. ${data.reason}`;
    },
  }),
  capture_snapshot: action({
    schema: z.object({}),
    preparer: true,
    async run({ actor, job, tx, now }) {
      if (job.activity !== 'W03' || !job.anniversaryDate)
        fail('This job has no annual anniversary.');
      if (job.snapshot)
        fail(
          'The historical snapshot is already frozen; create a linked correction for material discrepancies.',
        );
      if (job.anniversaryDate > today())
        fail(`Capture the anniversary snapshot on or after ${job.anniversaryDate}.`);
      const company = await repo.getCompany(job.companyId, tx);
      job.snapshot = {
        asAt: job.anniversaryDate,
        company: structuredClone(company),
        officers: officersAt(await repo.listOfficerEvents(job.companyId, tx), job.anniversaryDate),
        members: await memberSnapshot(job.companyId, job.anniversaryDate, tx),
        capturedAt: now,
      };
      job.clientConfirmed = false;
      job.clientConfirmationEvidenceId = null;
      appendVersion(job, actor, {
        documentIds: [],
        checklist: currentPack(job).checklist.map((item) => ({
          ...item,
          evidenceIds: [],
          notApplicable: undefined,
        })),
      });
      return `Captured and froze historical snapshot as at ${job.anniversaryDate}; earlier pack retained.`;
    },
  }),
  refresh_snapshot: action({
    schema: z.object({}),
    preparer: true,
    async run({ actor, job, tx, now }) {
      if (
        job.activity !== 'W03' ||
        !job.anniversaryDate ||
        !job.snapshot ||
        !job.snapshotNeedsReview
      )
        fail('No historical snapshot consequence is awaiting review.');
      if (job.filingAttempts.length)
        fail(
          'A submitted snapshot requires a linked correction route; filed originals are preserved.',
        );
      job.snapshotHistory ??= [];
      job.snapshotHistory.push({
        snapshot: structuredClone(job.snapshot),
        packVersion: currentPack(job).version,
      });
      const company = await repo.getCompany(job.companyId, tx);
      job.snapshot = {
        asAt: job.anniversaryDate,
        company: structuredClone(company),
        officers: officersAt(await repo.listOfficerEvents(job.companyId, tx), job.anniversaryDate),
        members: await memberSnapshot(job.companyId, job.anniversaryDate, tx),
        capturedAt: now,
      };
      job.snapshotNeedsReview = null;
      job.clientConfirmed = false;
      job.clientConfirmationEvidenceId = null;
      appendVersion(job, actor, {
        documentIds: [],
        checklist: currentPack(job).checklist.map((item) => ({
          ...item,
          evidenceIds: [],
          notApplicable: undefined,
        })),
      });
      return `Refreshed anniversary position after reviewed director event; prior snapshot retained and confirmation/review required again.`;
    },
  }),
  confirm_client: action({
    schema: z.object({ evidenceId: id }),
    preparer: true,
    preservedAfterSubmission: true,
    async run({ actor, job, tx }, data) {
      if (job.activity !== 'W03')
        fail('Client anniversary confirmation applies to annual returns.');
      if (!job.snapshot || job.snapshotNeedsReview)
        fail('Capture or refresh the anniversary snapshot before recording client confirmation.');
      await evidence(tx, actor, job.companyId, [data.evidenceId]);
      job.clientConfirmed = true;
      job.clientConfirmationEvidenceId = data.evidenceId;
      const items = structuredClone(currentPack(job).checklist),
        item = items.find((i) => i.id === 'client');
      if (item) item.evidenceIds = [data.evidenceId];
      appendVersion(job, actor, { checklist: items });
      return 'Client confirmation received and reconciled.';
    },
  }),
  sign: action({
    schema: z.object({ signer: text, evidenceId: id, receivedDate: calendarDate }),
    preparer: true,
    async run({ actor, job, tx }, data) {
      await evidence(tx, actor, job.companyId, [data.evidenceId]);
      if (data.receivedDate > today()) fail('Signature receipt cannot be in the future.');
      const pack = currentPack(job);
      if (!pack.requiredSigners.includes(data.signer))
        fail('Choose a required signer from the current pack.');
      if (!approved(job, 'pack')) fail('Review the exact pack version before recording execution.');
      if (pack.signatures.some((s) => s.signer === data.signer))
        fail('This signer already has evidence for this version.');
      pack.signatures.push(data);
      pack.state = executionBlockers(job).length ? 'Partly signed' : 'Fully signed';
      return `Recorded ${data.signer} signature for pack v${pack.version}.`;
    },
  }),
};
