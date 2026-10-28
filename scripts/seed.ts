import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { hashPassword } from 'better-auth/crypto';
import { closeDatabase, db, transaction, writerDb } from '../src/server/db';
import * as s from '../src/server/schema';
import {
  defaultPreferences,
  defaultSettings,
  type Capability,
  type Company,
  type Actor,
} from '../src/domain/model';
import { createJob, applyJobAction } from '../src/server/workflows';
import { ROLE_CAPABILITIES } from '../src/domain/model';
import { storeUpload } from '../src/server/storage';
import { syncDirectorProjection } from '../src/server/records/relationships';
import { lockCompany } from '../src/server/records/scope';
const existing = await db.select({ id: s.user.id }).from(s.user).limit(1);
if (existing.length) {
  console.log('Existing data retained; seed skipped.');
  closeDatabase();
  process.exit(0);
}
const companyIds = Array.from({ length: 6 }, () => randomUUID());
const now = new Date();
const definitions: { key: string; name: string; capabilities: Capability[]; scope: string[] }[] = [
  {
    key: 'owner',
    name: 'Owner administrator',
    capabilities: ROLE_CAPABILITIES.admin,
    scope: companyIds,
  },
  {
    key: 'executive',
    name: 'Aina Rahman',
    capabilities: ROLE_CAPABILITIES.user,
    scope: companyIds,
  },
  { key: 'reviewer', name: 'Daniel Tan', capabilities: ROLE_CAPABILITIES.user, scope: companyIds },
  { key: 'lodger', name: 'Mei Lim', capabilities: ROLE_CAPABILITIES.user, scope: companyIds },
  { key: 'admin', name: 'Account administrator', capabilities: ROLE_CAPABILITIES.admin, scope: [] },
  {
    key: 'limited',
    name: 'Scoped executive',
    capabilities: ROLE_CAPABILITIES.user,
    scope: [companyIds[0]],
  },
];
const credentials: { key: string; email: string; password: string; id: string }[] = [];
for (const def of definitions) {
  const id = randomUUID(),
    email = `${def.key}@cosec.local`,
    password = randomBytes(16).toString('base64url');
  await writerDb.insert(s.user).values({
    id,
    name: def.name,
    email,
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
    capabilities: def.capabilities,
    companyIds: def.scope,
    preferences: defaultPreferences,
    active: true,
  });
  await writerDb.insert(s.account).values({
    id: randomUUID(),
    userId: id,
    accountId: id,
    providerId: 'credential',
    password: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  });
  credentials.push({ key: def.key, email, password, id });
}
await writerDb.insert(s.settings).values({
  id: 'firm',
  revision: 1,
  data: {
    ...defaultSettings,
    defaultOwnerId: credentials.find((c) => c.key === 'executive')!.id,
  },
});
const names = [
  'Aster Advisory Sdn. Bhd.',
  'Meranti Trading Sdn. Bhd.',
  'Linden Ventures Sdn. Bhd.',
  'Cedar Field Sdn. Bhd.',
  'Ruang Studio Sdn. Bhd.',
  'Bayu Services Sdn. Bhd.',
];
const companies: Company[] = names.map((name, i) => ({
  id: companyIds[i],
  name,
  registrationNumber: `2020${String(i + 1).padStart(8, '0')}`,
  incorporationDate: `2020-${String(9 + (i % 3)).padStart(2, '0')}-15`,
  financialYearEnd: '12-31',
  legalStatus: 'Existing',
  engagementStatus: 'Active',
  address: `${12 + i} Jalan Contoh, Kuala Lumpur`,
  industry: 'M',
  activity: 'Fictional evaluation company',
  verification: 'Unverified',
  sourceEvidenceId: null,
  revision: 1,
}));
for (const company of companies)
  await writerDb.insert(s.companies).values({ id: company.id, data: company });
const executive = credentials.find((c) => c.key === 'executive')!;
const actor: Actor = {
  id: executive.id,
  name: 'Aina Rahman',
  email: executive.email,
  capabilities: ['prepare_job'],
  companyIds,
  preferences: defaultPreferences,
};
for (let i = 0; i < companies.length; i++) {
  const company = companies[i];
  const document = await storeUpload(actor, {
    companyId: company.id,
    title: 'Fictional opening source',
    file: new File(
      [
        `FICTIONAL EVALUATION EVIDENCE ONLY\n${company.name}\nNo statutory or professional approval implied.\n`,
      ],
      `opening-${i + 1}.txt`,
      { type: 'text/plain' },
    ),
  });
  const openingId = randomUUID();
  await writerDb.insert(s.officerEvents).values({
    id: openingId,
    companyId: company.id,
    data: {
      id: openingId,
      companyId: company.id,
      jobId: 'opening-fixture',
      personId: `person-${i + 1}`,
      personName: [
        'Adrian Lee',
        'Siti Noor',
        'Chong Wei',
        'Nadia Aziz',
        'Ravi Kumar',
        'Farah Hassan',
      ][i],
      route: 'appointment',
      effectiveDate: company.incorporationDate,
      recordedAt: now.toISOString(),
      evidenceIds: [document.id],
      basis: 'Fictional reviewed opening fixture for evaluation; not a live appointment.',
      reviewerId: credentials.find((c) => c.key === 'reviewer')!.id,
      predecessorId: null,
    },
  });
  // Reads no longer project lazily; posting and seeding refresh director relationships.
  await transaction(async (tx) => {
    await lockCompany(company.id, tx);
    await syncDirectorProjection(company.id, tx);
  });
  const job = await createJob(
    actor,
    {
      companyId: company.id,
      activity: i % 2 === 0 ? 'W03' : 'W04',
      ownerId: actor.id,
      ...(i % 2 === 0
        ? { year: 2026, anniversaryDate: `2026-${company.incorporationDate.slice(5)}` }
        : {
            route: i === 3 ? 'resignation' : 'appointment',
            personId: i === 3 ? `person-${i + 1}` : randomUUID(),
            personName: i === 3 ? 'Nadia Aziz' : ['', 'Rina Wong', '', '', '', 'Arif Zain'][i],
            effectiveDate: '2026-10-20',
            routeBasis:
              i === 3
                ? 'Fictional resignation instructions; route evidence requires review.'
                : 'Fictional appointment instructions; consent and authority require review.',
            sourceEvidenceIds: [document.id],
          }),
      internalTarget: i < 2 ? '2026-10-19' : '2026-11-05',
    },
    randomUUID(),
  );
  if (i === 0)
    await applyJobAction(actor, job.id, {
      action: 'correspondence',
      expectedRevision: job.revision,
      requestId: randomUUID(),
      direction: 'Outgoing',
      counterparty: 'Client contact',
      channel: 'Email (sent externally)',
      date: '2026-10-15',
      summary: 'Requested confirmation of anniversary particulars.',
      ownerId: actor.id,
      evidenceIds: [document.id],
      nextChaseDate: '2026-10-22',
    });
}
await mkdir('.local', { recursive: true });
await writeFile('.local/accounts.json', JSON.stringify(credentials, null, 2), { mode: 0o600 });
await writeFile(
  '.local/ACCOUNTS.md',
  '# Fictional local evaluation accounts\n\nIndependent review is required. Sign out before testing a different account.\n\n' +
    credentials.map((c) => `- ${c.key}: ${c.email} — ${c.password}`).join('\n') +
    '\n',
  { mode: 0o600 },
);
console.log(
  'Seeded six fictional companies and six jobs. Credentials saved privately in .local/ACCOUNTS.md.',
);
closeDatabase();
