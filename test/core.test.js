import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, validateConfig } from '../src/config.js';
import { buildExternalContext, reviseRecord } from '../src/context.js';
import { saveVault, loadVault } from '../src/vault.js';
import { DraftWorkflow } from '../src/workflow.js';
import { RedditReader } from '../src/reddit.js';
import { checkPublicFiles } from '../scripts/check-public.js';

const defaults = await loadConfig();
const config = () => ({ ...defaults, allowlistedSubreddits: ['SyntheticDemo'] });
const record = (changes = {}) => ({ id: 'example', layer: 'identity', text: 'Synthetic preference', visibility: 'public', approvedForExternalUse: true, revision: 1, ...changes });
const comment = (changes = {}) => ({ id: 't1_demo', subreddit: 'SyntheticDemo', author: 'ExampleUser', deleted: false, removed: false, locked: false, ...changes });

test('default config has no approval or communities', () => {
  assert.equal(defaults.redditAccessApproved, false); assert.deepEqual(defaults.allowlistedSubreddits, []);
});
test('configuration rejects invalid limits and missing disclosure', () => {
  for (const changes of [{ maxReadsPerMinute: 7 }, { cooldownSeconds: 1 }, { maxDraftsPerDay: 0 }, { disclosure: 'Hello' }, { redditAccessApproved: 'true' }, { allowlistedSubreddits: ['../escape'] }]) {
    assert.throws(() => validateConfig({ ...config(), ...changes }));
  }
});
test('private records never leave even when marked approved', () => {
  assert.deepEqual(buildExternalContext([record({ visibility: 'private' })]), []);
});
test('public records require consent; accepted output excludes control fields', () => {
  assert.deepEqual(buildExternalContext([record({ approvedForExternalUse: false })]), []);
  assert.deepEqual(buildExternalContext([record()]), [{ id: 'example', layer: 'identity', revision: 1, text: 'Synthetic preference' }]);
});
test('missing approval and duplicate context ids fail closed', () => {
  assert.throws(() => buildExternalContext([record({ approvedForExternalUse: undefined })]));
  assert.throws(() => buildExternalContext([record(), record()]));
});
test('revision preserves source and revokes external consent', () => {
  const original = [record()]; const changed = reviseRecord(original, 'example', 'Synthetic revision');
  assert.equal(changed[0].revision, 2); assert.equal(changed[0].approvedForExternalUse, false);
  assert.equal(original[0].revision, 1); assert.throws(() => reviseRecord(original, 'missing', 'text'));
});
test('vault encrypts and decrypts outside repository, refuses overwrite and wrong key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axiom-test-'));
  try {
    const file = join(dir, 'test.vault'), key = '11'.repeat(32);
    await saveVault(file, [record({ visibility: 'private' })], key);
    assert.ok(!(await readFile(file, 'utf8')).includes('Synthetic preference'));
    assert.deepEqual(await loadVault(file, key), [record({ visibility: 'private' })]);
    await assert.rejects(saveVault(file, [record()], key));
    await assert.rejects(loadVault(file, '22'.repeat(32)));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('vault detects modified ciphertext and rejects repo paths/invalid keys', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'axiom-test-'));
  try {
    const file = join(dir, 'test.vault'), key = '11'.repeat(32);
    await saveVault(file, [record()], key);
    const e = JSON.parse(await readFile(file, 'utf8')); const b = Buffer.from(e.data, 'base64'); b[0] ^= 1; e.data = b.toString('base64');
    await writeFile(file, JSON.stringify(e)); await assert.rejects(loadVault(file, key));
    await assert.rejects(saveVault(join(process.cwd(), 'bad.vault'), [record()], key), /outside repository/);
    await assert.rejects(saveVault(join(dir, 'invalid.vault'), [record()], 'invalid'), /32-byte/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('draft discloses AI, filters private context and requires exact reviewed hash', () => {
  const w = new DraftWorkflow(config()); const d = w.create(comment(), 'Synthetic reply', [record({ visibility: 'private' })]);
  assert.match(d.body, /AI discussion agent/); assert.deepEqual(d.context, []);
  assert.throws(() => w.approve(d.id, 'wrong')); d.body = 'tampered';
  assert.equal(w.approve(d.id, d.bodyHash).body.includes('tampered'), false);
  assert.throws(() => w.publish(), /not implemented/);
});
test('empty allowlist, self replies and operator blocklist are rejected', () => {
  assert.throws(() => new DraftWorkflow(defaults).create(comment(), 'reply'));
  assert.throws(() => new DraftWorkflow(config()).create(comment({ author: 'axiomrook' }), 'reply'));
  assert.throws(() => new DraftWorkflow({ ...config(), blockedUsers: ['exampleuser'] }).create(comment(), 'reply'));
});
test('removed, deleted, locked or unknown-status comments are rejected', () => {
  for (const changes of [{ removed: true }, { deleted: true }, { locked: true }, { locked: undefined }]) {
    assert.throws(() => new DraftWorkflow(config()).create(comment(changes), 'reply'));
  }
});
test('cooldown, exact normalized duplication and repeated target are rejected', () => {
  let time = 0; const w = new DraftWorkflow(config(), () => time); w.create(comment(), 'Synthetic Reply');
  assert.throws(() => w.create(comment({ id: 't1_other' }), 'another'), /Cooldown/);
  time = 600000;
  assert.throws(() => w.create(comment({ id: 't1_other' }), '  synthetic   reply '), /Duplicate/);
  assert.throws(() => w.create(comment(), 'another'), /Duplicate/);
});
test('daily cap and expiry are enforced', () => {
  let time = 0; const w = new DraftWorkflow({ ...config(), maxDraftsPerDay: 1 }, () => time);
  const d = w.create(comment(), 'reply'); time = 600000;
  assert.throws(() => w.create(comment({ id: 't1_other' }), 'other'), /Daily/);
  time = 86400000; assert.throws(() => w.approve(d.id, d.bodyHash), /expired/);
  assert.ok(w.create(comment({ id: 't1_other' }), 'other'));
});
test('reader never calls network without approval, token or allowlist', async () => {
  let calls = 0; const stub = async () => { calls++; throw new Error('Unexpected network'); };
  await assert.rejects(new RedditReader(config(), 'synthetic-token', stub).readComments('SyntheticDemo'), /approval/);
  await assert.rejects(new RedditReader({ ...config(), redditAccessApproved: true }, '', stub).readComments('SyntheticDemo'), /token/);
  await assert.rejects(new RedditReader({ ...config(), redditAccessApproved: true }, 'synthetic-token', stub).readComments('Other'), /allowlisted/);
  assert.equal(calls, 0);
});
test('reader uses fixed OAuth host, redirects disabled and minimal bounded output', async () => {
  let time = 0, calls = 0;
  const w = new RedditReader({ ...config(), redditAccessApproved: true }, 'synthetic-token', async (url, options) => {
    calls++; assert.equal(url, 'https://oauth.reddit.com/r/SyntheticDemo/comments?limit=25&raw_json=1');
    assert.equal(options.redirect, 'error'); assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
    return new Response(JSON.stringify({ data: { children: [{ kind: 't1', data: { name: 't1_demo', subreddit: 'SyntheticDemo', author: 'ExampleUser', body: 'synthetic', locked: false } }] } }), { status: 200 });
  }, () => time);
  const rows = await w.readComments('SyntheticDemo'); assert.equal(rows.length, 1); assert.equal(rows[0].locked, false);
  await assert.rejects(w.readComments('SyntheticDemo'), /rate limit/); assert.equal(calls, 1);
  time = 10000; await w.readComments('SyntheticDemo'); assert.equal(calls, 2);
});
test('429 header enforces cooldown and has no automatic retry', async () => {
  let calls = 0, time = 0;
  const r = new RedditReader({ ...config(), redditAccessApproved: true }, 'synthetic-token', async () => {
    calls++; return new Response('', { status: 429, headers: { 'retry-after': '120' } });
  }, () => time);
  await assert.rejects(r.readComments('SyntheticDemo'), /429/); time = 10000;
  await assert.rejects(r.readComments('SyntheticDemo'), /rate limit/); assert.equal(calls, 1);
});
test('quota exhaustion from successful response also enforces reset', async () => {
  let time = 0;
  const r = new RedditReader({ ...config(), redditAccessApproved: true }, 'synthetic-token', async () => new Response('{"data":{"children":[]}}', { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '180' } }), () => time);
  await r.readComments('SyntheticDemo'); time = 10000; await assert.rejects(r.readComments('SyntheticDemo'), /rate limit/);
});
test('concurrent reads and malformed responses are rejected', async () => {
  let finish; const response = new Promise(resolve => { finish = resolve; });
  const r = new RedditReader({ ...config(), redditAccessApproved: true }, 'synthetic-token', () => response);
  const pending = r.readComments('SyntheticDemo'); await assert.rejects(r.readComments('SyntheticDemo'), /rate limit/);
  finish(new Response('{}')); await assert.rejects(pending, /Unexpected Reddit response/);
});
test('public file scanner rejects unknown paths, tokens and email addresses', () => {
  assert.match(checkPublicFiles(['private/context.json'], () => '{}')[0], /Unapproved/);
  assert.match(checkPublicFiles(['README.md'], () => 'ghp_' + 'x'.repeat(20))[0], /credential/);
  assert.match(checkPublicFiles(['README.md'], () => ['example', 'invalid.test'].join('@'))[0], /Email/);
  assert.deepEqual(checkPublicFiles(['README.md'], () => 'Synthetic documentation'), []);
});
