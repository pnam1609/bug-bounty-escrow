import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import process from 'node:process';
import { hashSync } from 'bcryptjs';

import {
  assertDemoSeedTargetSafety,
  assertProductionDemoIdentitySafety,
  DEMO_PASSWORD,
  DEMO_PASSWORD_SALT,
  isLocalDemoIdentityWaiverActive,
  productionSafetyTestConstants,
} from './production-safety.mjs';
import { ensureCompatibilityLayer } from './migrate.mjs';

function fakeClient(results) {
  const queue = Array.isArray(results) ? [...results] : [results];
  return {
    calls: 0,
    statements: [],
    async query(text, values) {
      this.calls += 1;
      this.statements.push({ text, values });
      const result = queue.shift();
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

assert.doesNotThrow(() =>
  assertDemoSeedTargetSafety({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://postgres:secret@127.0.0.1:54322/postgres',
  }),
);
assert.doesNotThrow(() =>
  assertDemoSeedTargetSafety({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://postgres:secret@[::1]:54322/postgres',
  }),
);
assert.throws(
  () =>
    assertDemoSeedTargetSafety({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://postgres:secret@supabase-db:5432/postgres',
      DEMO_ENV: 'demo',
      DEMO_SEED_CONFIRM: productionSafetyTestConstants.remoteDemoConfirmation,
      LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: '2999-01-01T00:00:00.000Z',
    }),
  /Demo data cannot be seeded in production/,
);

const waiverClock = Date.parse('2026-08-07T16:59:00.000Z');
for (const [allowedUntil, expected] of [
  [undefined, false],
  ['', false],
  ['not-a-timestamp', false],
  ['2026-08-07T23:59:00+07:00', false],
  ['2026-02-30T00:00:00Z', false],
  ['2026-08-07T16:59:00z', false],
  ['2026-08-07T16:59:00.1Z', false],
  ['2026-08-07T16:59:00.0000Z', false],
  ['2026-08-07T16:59:00.000Z', false],
  ['2026-08-07T16:59:00.001Z', true],
]) {
  assert.equal(
    isLocalDemoIdentityWaiverActive(
      { LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: allowedUntil },
      waiverClock,
    ),
    expected,
  );
}
const boundedFutureWaiver = new Date(Date.now() + 60_000).toISOString();
assert.throws(
  () =>
    assertDemoSeedTargetSafety({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:secret@shared-db:5432/postgres',
    }),
  /Remote demo seeding requires/,
);
assert.throws(
  () =>
    assertDemoSeedTargetSafety({
      NODE_ENV: 'development',
      DEMO_ENV: 'local',
    }),
  /DATABASE_URL is required to seed demo data/,
);
assert.doesNotThrow(() =>
  assertDemoSeedTargetSafety({
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://postgres:secret@shared-demo-db:5432/postgres',
    DEMO_ENV: 'demo',
    DEMO_SEED_CONFIRM: productionSafetyTestConstants.remoteDemoConfirmation,
  }),
);

const nonProductionClient = fakeClient(new Error('must not query'));
await assertProductionDemoIdentitySafety(nonProductionClient, { NODE_ENV: 'test' });
assert.equal(nonProductionClient.calls, 0);

const validHostedCatalog = {
  rows: [{ has_auth_users: true, has_authenticated_role: true }],
};
const safeClient = fakeClient([
  validHostedCatalog,
  { rows: [{ has_active_demo_identity: false }] },
]);
await assertProductionDemoIdentitySafety(safeClient, { NODE_ENV: 'production' });
assert.equal(safeClient.calls, 2);
const [
  { text: catalogQuery, values: catalogValues },
  { text: productionQuery, values: productionValues },
] = safeClient.statements;
assert.match(catalogQuery.trim(), /^select\s+/);
assert.match(catalogQuery, /to_regclass\('auth\.users'\)/);
assert.match(catalogQuery, /rolname = 'authenticated'/);
assert.equal(catalogValues, undefined);
for (const suffix of ['001', '002', '003', '004', '005', '006', '007']) {
  assert.match(productionQuery, new RegExp(`'30000000-0000-4000-8000-000000000${suffix}'::uuid`));
}
assert.match(productionQuery, /lower\(coalesce\(email, ''\)\) like '%@local\.demo'/);
assert.match(productionQuery, /encrypted_password = \$1/);
assert.deepEqual(productionValues, [hashSync(DEMO_PASSWORD, DEMO_PASSWORD_SALT), false]);
assert.match(productionQuery.trim(), /^select exists \(/);
assert.doesNotMatch(productionQuery, /select\s+(email|encrypted_password|banned_until)\b/i);

const waivedClient = fakeClient([
  validHostedCatalog,
  { rows: [{ has_active_demo_identity: false }] },
]);
await assertProductionDemoIdentitySafety(waivedClient, {
  NODE_ENV: 'production',
  LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: boundedFutureWaiver,
});
assert.equal(waivedClient.calls, 2);
assert.deepEqual(waivedClient.statements[1].values, [
  hashSync(DEMO_PASSWORD, DEMO_PASSWORD_SALT),
  true,
]);

await assert.rejects(
  assertProductionDemoIdentitySafety(
    fakeClient([validHostedCatalog, { rows: [{ has_active_demo_identity: true }] }]),
    {
      NODE_ENV: 'production',
      LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: boundedFutureWaiver,
    },
  ),
  (error) => {
    assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
    return true;
  },
);

await assert.rejects(
  assertProductionDemoIdentitySafety(
    fakeClient([validHostedCatalog, { rows: [{ has_active_demo_identity: true }] }]),
    {
      NODE_ENV: 'production',
      LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: '2000-01-01T00:00:00Z',
    },
  ),
  (error) => {
    assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
    return true;
  },
);

await assert.rejects(
  assertProductionDemoIdentitySafety(
    fakeClient({ rows: [{ has_auth_users: true, has_authenticated_role: false }] }),
    {
      NODE_ENV: 'production',
      LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: boundedFutureWaiver,
    },
  ),
  (error) => {
    assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
    return true;
  },
);

const freshBareClient = fakeClient({
  rows: [{ has_auth_users: false, has_authenticated_role: false }],
});
await assertProductionDemoIdentitySafety(freshBareClient, { NODE_ENV: 'production' });
assert.equal(freshBareClient.calls, 1);

for (const partialCatalog of [
  { has_auth_users: true, has_authenticated_role: false },
  { has_auth_users: false, has_authenticated_role: true },
]) {
  await assert.rejects(
    assertProductionDemoIdentitySafety(fakeClient({ rows: [partialCatalog] }), {
      NODE_ENV: 'production',
    }),
    (error) => {
      assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
      return true;
    },
  );
}

for (const result of [
  { rows: [{ has_active_demo_identity: true }] },
  { rows: [] },
  { rows: [{ has_active_demo_identity: 'false' }] },
  new Error('connection contained a sensitive detail'),
]) {
  await assert.rejects(
    assertProductionDemoIdentitySafety(fakeClient([validHostedCatalog, result]), {
      NODE_ENV: 'production',
    }),
    (error) => {
      assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
      assert.equal(error.message.includes('sensitive detail'), false);
      return true;
    },
  );
}

await assert.rejects(
  assertProductionDemoIdentitySafety(
    fakeClient(new Error('catalog connection contained a sensitive detail')),
    { NODE_ENV: 'production' },
  ),
  (error) => {
    assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
    assert.equal(error.message.includes('sensitive detail'), false);
    return true;
  },
);

const freshProductionDatabase = new PGlite();
try {
  await assertProductionDemoIdentitySafety(freshProductionDatabase, {
    NODE_ENV: 'production',
  });
  const compatibilityClient = {
    async query(text, values) {
      if (values !== undefined || /^\s*select\b/i.test(text)) {
        return freshProductionDatabase.query(text, values);
      }
      await freshProductionDatabase.exec(text);
      return { rows: [] };
    },
  };
  assert.equal(await ensureCompatibilityLayer(compatibilityClient), true);
  await assertProductionDemoIdentitySafety(freshProductionDatabase, {
    NODE_ENV: 'production',
  });
} finally {
  await freshProductionDatabase.close();
}

const tableOnlyDatabase = new PGlite();
try {
  await tableOnlyDatabase.exec(`
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      encrypted_password text,
      banned_until timestamp with time zone
    );
  `);
  await assert.rejects(
    assertProductionDemoIdentitySafety(tableOnlyDatabase, { NODE_ENV: 'production' }),
    (error) => {
      assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
      return true;
    },
  );
} finally {
  await tableOnlyDatabase.close();
}

const productionDatabase = new PGlite();
try {
  await productionDatabase.exec(`
    create role authenticated nologin;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      encrypted_password text,
      banned_until timestamp with time zone
    );
  `);

  const assertRealPreflightRejects = async () => {
    await assert.rejects(
      assertProductionDemoIdentitySafety(productionDatabase, { NODE_ENV: 'production' }),
      (error) => {
        assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
        return true;
      },
    );
  };

  // Prove the query matches every exact seeded UUID, but not an unrelated UUID sharing the prefix.
  await productionDatabase.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [
    '30000000-0000-4000-8000-000000000099',
    'unrelated@example.test',
  ]);
  await assertProductionDemoIdentitySafety(productionDatabase, { NODE_ENV: 'production' });

  for (const suffix of ['001', '002', '003', '004', '005', '006', '007']) {
    const id = `30000000-0000-4000-8000-000000000${suffix}`;
    await productionDatabase.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [
      id,
      `fixture-${suffix}@example.test`,
    ]);
    await assertProductionDemoIdentitySafety(productionDatabase, {
      NODE_ENV: 'production',
      LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: boundedFutureWaiver,
    });
    await assertRealPreflightRejects();
    await productionDatabase.query(
      `update auth.users set banned_until = now() + interval '100 years' where id = $1::uuid`,
      [id],
    );
    await assertProductionDemoIdentitySafety(productionDatabase, { NODE_ENV: 'production' });
  }

  await productionDatabase.query(`insert into auth.users (id, email) values ($1::uuid, $2)`, [
    '10000000-0000-4000-8000-000000000010',
    'mixed-case@LOCAL.DEMO',
  ]);
  await assert.rejects(
    assertProductionDemoIdentitySafety(productionDatabase, {
      NODE_ENV: 'production',
      LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: boundedFutureWaiver,
    }),
    (error) => {
      assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
      return true;
    },
  );
  await assertRealPreflightRejects();
  await productionDatabase.query(
    `update auth.users set banned_until = now() + interval '100 years' where id = $1::uuid`,
    ['10000000-0000-4000-8000-000000000010'],
  );

  await productionDatabase.query(
    `insert into auth.users (id, email, encrypted_password) values ($1::uuid, $2, $3)`,
    [
      '10000000-0000-4000-8000-000000000011',
      'known-hash@example.test',
      hashSync(DEMO_PASSWORD, DEMO_PASSWORD_SALT),
    ],
  );
  await assert.rejects(
    assertProductionDemoIdentitySafety(productionDatabase, {
      NODE_ENV: 'production',
      LOCAL_DEMO_IDENTITIES_ALLOWED_UNTIL: boundedFutureWaiver,
    }),
    (error) => {
      assert.equal(error.message, productionSafetyTestConstants.productionPreflightError);
      return true;
    },
  );
  await assertRealPreflightRejects();
  await productionDatabase.query(
    `update auth.users set banned_until = now() + interval '100 years' where id = $1::uuid`,
    ['10000000-0000-4000-8000-000000000011'],
  );
  await assertProductionDemoIdentitySafety(productionDatabase, { NODE_ENV: 'production' });
  await productionDatabase.query(
    `update auth.users set banned_until = now() - interval '1 second' where id = $1::uuid`,
    ['10000000-0000-4000-8000-000000000011'],
  );
  await assertRealPreflightRejects();
} finally {
  await productionDatabase.close();
}

process.stdout.write('Production demo-identity safety checks passed\n');
