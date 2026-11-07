import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statements, classify, flattenMigration } from './shared-db-sql.mjs';

test('keeps routine, tagged block, quoted semicolons and nested comments intact', () => {
  const sql = `begin; /* outer /* ; */ */ create function f() returns void as $body$ begin perform ';'; end; $body$ language plpgsql; do $$begin null; end$$; select 'a'';b', "s;"; commit;`;
  assert.equal(statements(sql).length, 5);
  const flat = flattenMigration(sql);
  assert.match(flat, /perform ';'; end;/);
  assert.equal(statements(flat).length, 3);
  assert.deepEqual(statements(flat).map(classify), ['function-definition','do-block-review-required','top-level-data-or-call-review-required']);
});
test('rejects malformed strings, comments and transaction surprises', () => {
  for (const sql of ["select 'x", 'do $$begin;', '/* open']) assert.throws(() => statements(sql));
  for (const sql of ['begin; select 1;', 'commit;', 'begin; begin; commit;', 'begin; commit; update x set a=1;', 'rollback;']) assert.throws(() => flattenMigration(sql));
});
test('distinguishes installing a callable function from executing its writes', () => {
  assert.equal(classify('create or replace function f() returns void as $$ begin update x set a=1; end $$ language plpgsql;'), 'function-definition');
  assert.equal(classify('/* review */ update x set a=1;'), 'top-level-data-or-call-review-required');
  assert.equal(classify('select public.enable_pilot_if_empty();'), 'top-level-data-or-call-review-required');
});
