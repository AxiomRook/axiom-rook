import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { ChatGPTAuth, createAttempt, authorizationUrl, consumeCallback, normalizeTokens, OpenAIIdentityVerifier, loopbackAuthorization, ISSUER, TOKEN, AUTHORIZE, DISCOVERY, RESOURCE, SCOPES } from '../src/chatgpt-auth.js';
import { ChatGPTClient, filterModels, manualResponseBody, consumeResponseStream } from '../src/chatgpt-client.js';
import { ChatGPTError, redactSensitive, formatSafeError, providerError } from '../src/chatgpt-errors.js';
import { PrivateChatGPTStore, emptyState, generateHostId, validateState, safeStatus, defaultPrivateDirectory } from '../src/chatgpt-store.js';
import { runChatGPTCommand } from '../src/chatgpt-cli.js';
import { checkPublicFiles } from '../scripts/check-public.js';

const NOW = 1700000000000, CLIENT = 'oaiapp_' + 'synthetic', SUBJECT = 'synthetic-subject';
const { publicKey, privateKey } = await generateKeyPair('RS256', { modulusLength: 2048 });
const jwk = { ...await exportJWK(publicKey), kid: 'synthetic-key', alg: 'RS256', use: 'sig' };
const discovery = { issuer: ISSUER, authorization_endpoint: AUTHORIZE, token_endpoint: TOKEN,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`, revocation_endpoint: `${ISSUER}/api/accounts/oauth/revoke` };
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
async function idToken(nonce, { subject = SUBJECT, audience = CLIENT, issuer = ISSUER, exp = NOW / 1000 + 3600, kid = jwk.kid, key = privateKey } = {}) {
  return new SignJWT(nonce === undefined ? {} : { nonce }).setProtectedHeader({ alg: 'RS256', kid })
    .setIssuer(issuer).setAudience(audience).setSubject(subject).setIssuedAt(NOW / 1000).setExpirationTime(exp).sign(key);
}
const tokenBody = (id, changes = {}) => ({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', id_token: id,
  token_type: 'Bearer', expires_in: 3600, scope: SCOPES, ...changes });
const modelList = { models: [{ slug: 'synthetic-model', display_name: 'Synthetic model', visibility: 'list' },
  { slug: 'hidden-model', display_name: 'Hidden model', visibility: 'hidden' }] };
const sse = events => new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
const completed = text => ({ type: 'response.completed', response: { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }] } });
const contextRecord = changes => ({ id: 'synthetic-record', layer: 'memory', text: 'Synthetic approved history', visibility: 'public', approvedForExternalUse: true, revision: 1, ...changes });

async function fixture(t, { signedIn = true, expires = NOW + 3600000, scope = SCOPES } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'axiom-chatgpt-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = new PrivateChatGPTStore(join(dir, 'private'));
  const state = emptyState();
  if (signedIn) {
    state.ext_agent_host_id = generateHostId(); state.active_registration_id = 'synthetic-account';
    state.registrations.push({ id: 'synthetic-account', label: 'Account 1', client_id: CLIENT, issuer: ISSUER,
      subject: SUBJECT, selected_model: 'synthetic-model', tokens: { ...normalizeTokens(tokenBody('synthetic-id', { scope }), NOW), access_expires_at: expires } });
    await store.withLock(() => store.write(state));
  }
  return { store, state, dir };
}

function fakeOpenAI(extra = async () => { throw new Error('Unexpected external call'); }) {
  return async (url, options = {}) => {
    assert.equal(options.redirect, 'error');
    if (url === DISCOVERY) return json(discovery);
    if (url === discovery.jwks_uri) return json({ keys: [jwk] });
    return extra(url, options);
  };
}

function fakeAuthorize(onAttempt = () => {}) {
  return async options => {
    const attempt = createAttempt({ ...options, port: 34567, now: NOW });
    onAttempt(attempt, options);
    const url = new URL(attempt.redirectUri); url.search = new URLSearchParams({ state: attempt.state, code: 'synthetic-code', client_id: attempt.clientId === 'dynamic_agent_client' ? CLIENT : attempt.clientId });
    return { ...consumeCallback(attempt, url.toString(), NOW), attempt };
  };
}

test('each OAuth attempt has fresh state, nonce and S256 PKCE; exact OSS scopes and resource', () => {
  const hostId = generateHostId(), a = createAttempt({ port: 12345, hostId, now: NOW }), b = createAttempt({ port: 12345, hostId, now: NOW });
  assert.notEqual(a.state, b.state); assert.notEqual(a.nonce, b.nonce); assert.notEqual(a.verifier, b.verifier);
  assert.equal(a.challenge, createHash('sha256').update(a.verifier).digest('base64url')); assert.match(a.verifier, /^[A-Za-z0-9_-]{43,128}$/);
  const url = new URL(authorizationUrl(a));
  assert.equal(url.origin + url.pathname, AUTHORIZE); assert.equal(url.searchParams.get('client_id'), 'dynamic_agent_client');
  assert.equal(url.searchParams.get('agent_name_hint'), 'Axiom Rook'); assert.equal(url.searchParams.get('ext_agent_host_id'), hostId);
  assert.equal(url.searchParams.get('scope'), SCOPES); assert.equal(url.searchParams.get('resource'), RESOURCE);
  assert.equal(url.searchParams.get('redirect_uri'), 'http://127.0.0.1:12345/auth/callback'); assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.has('client_secret'), false); assert.equal(url.searchParams.has('id_token_hint'), false);
});
test('returning authorization reuses client/host and requests fresh explicit consent only when chosen', () => {
  const a = createAttempt({ port: 54321, hostId: generateHostId(), registration: { client_id: CLIENT }, enablePlan: true, now: NOW });
  const url = new URL(authorizationUrl(a)); assert.equal(url.searchParams.get('client_id'), CLIENT);
  assert.equal(url.searchParams.has('agent_name_hint'), false); assert.equal(url.searchParams.get('prompt'), 'consent');
  const ordinary = new URL(authorizationUrl({ ...a, enablePlan: false })); assert.equal(ordinary.searchParams.has('prompt'), false);
});
test('callback rejects state mismatch, expired/reused attempts and duplicate parameters', () => {
  const make = () => createAttempt({ port: 12345, hostId: generateHostId(), now: NOW });
  let a = make(); assert.throws(() => consumeCallback(a, `${a.redirectUri}?state=wrong&code=x&client_id=${CLIENT}`, NOW), e => e.code === 'invalid_state');
  a = make(); assert.throws(() => consumeCallback(a, `${a.redirectUri}?state=${a.state}&code=x&client_id=${CLIENT}`, NOW + 600000), e => e.code === 'invalid_state');
  a = make(); const url = `${a.redirectUri}?state=${a.state}&code=x&client_id=${CLIENT}`;
  assert.equal(consumeCallback(a, url, NOW).clientId, CLIENT); assert.throws(() => consumeCallback(a, url, NOW), e => e.code === 'invalid_state');
  a = make(); assert.throws(() => consumeCallback(a, `${a.redirectUri}?state=${a.state}&state=${a.state}&code=x&client_id=${CLIENT}`, NOW), e => e.code === 'invalid_callback');
});
test('callback only accepts exact 127.0.0.1 host, port and /auth/callback path', () => {
  for (const base of ['http://localhost:12345/auth/callback', 'http://127.0.0.1:54321/auth/callback', 'http://127.0.0.1:12345/callback', 'https://127.0.0.1:12345/auth/callback']) {
    const a = createAttempt({ port: 12345, hostId: generateHostId(), now: NOW });
    assert.throws(() => consumeCallback(a, `${base}?state=${a.state}&code=x&client_id=${CLIENT}`, NOW), e => e.code === 'invalid_callback');
  }
});
test('declined consent validates state and never accepts a code', () => {
  const a = createAttempt({ port: 12345, hostId: generateHostId(), now: NOW });
  assert.throws(() => consumeCallback(a, `${a.redirectUri}?state=${a.state}&error=access_denied&code=x`, NOW), e => e.code === 'consent_denied');
});
test('new registration needs real client ID; reauthorization refuses client substitution', () => {
  for (const clientId of ['', 'dynamic_agent_client']) {
    const a = createAttempt({ port: 12345, hostId: generateHostId(), now: NOW });
    assert.throws(() => consumeCallback(a, `${a.redirectUri}?state=${a.state}&code=x&client_id=${clientId}`, NOW), e => e.code === 'registration_incomplete');
  }
  const a = createAttempt({ port: 12345, hostId: generateHostId(), registration: { client_id: CLIENT }, now: NOW });
  assert.throws(() => consumeCallback(a, `${a.redirectUri}?state=${a.state}&code=x&client_id=oaiapp_other`, NOW), e => e.code === 'account_mismatch');
  const b = createAttempt({ port: 12345, hostId: generateHostId(), registration: { client_id: CLIENT }, now: NOW });
  assert.equal(consumeCallback(b, `${b.redirectUri}?state=${b.state}&code=x`, NOW).clientId, CLIENT);
});
test('ID token verifies signature, issuer, audience, expiry, nonce and subject', async () => {
  const verifier = new OpenAIIdentityVerifier(fakeOpenAI(), () => NOW), valid = await idToken('synthetic-nonce');
  assert.deepEqual(await verifier.verify(valid, { clientId: CLIENT, nonce: 'synthetic-nonce' }), { issuer: ISSUER, subject: SUBJECT });
  for (const options of [{ issuer: 'https://invalid.example' }, { audience: 'oaiapp_other' }, { exp: NOW / 1000 - 10 }, { subject: 'other-subject' }]) {
    await assert.rejects(verifier.verify(await idToken('synthetic-nonce', options), { clientId: CLIENT, nonce: 'synthetic-nonce', subject: SUBJECT }), e => e.code === 'invalid_identity');
  }
  await assert.rejects(verifier.verify(valid, { clientId: CLIENT, nonce: 'wrong' }), e => e.code === 'invalid_identity');
  const { privateKey: wrongKey } = await generateKeyPair('RS256');
  await assert.rejects(verifier.verify(await idToken('synthetic-nonce', { key: wrongKey }), { clientId: CLIENT, nonce: 'synthetic-nonce' }), e => e.code === 'invalid_identity');
});
test('unknown JWKS kid causes one fresh key lookup; tokens cannot choose their own endpoint', async () => {
  let keyCalls = 0;
  const verifier = new OpenAIIdentityVerifier(async url => {
    if (url === DISCOVERY) return json(discovery);
    assert.equal(url, discovery.jwks_uri); keyCalls++;
    return json({ keys: [{ ...jwk, kid: keyCalls === 1 ? 'previous-key' : 'rotated-key' }] });
  }, () => NOW);
  await verifier.verify(await idToken('n', { kid: 'rotated-key' }), { clientId: CLIENT, nonce: 'n' }); assert.equal(keyCalls, 2);
  const bad = new OpenAIIdentityVerifier(async () => json({ ...discovery, jwks_uri: 'https://invalid.example/keys' }), () => NOW);
  await assert.rejects(bad.verify(await idToken('n'), { clientId: CLIENT, nonce: 'n' }), e => e.code === 'invalid_identity');
});
test('host IDs use opaque JWK thumbprint URIs and do not identify the user', () => {
  const a = generateHostId(), b = generateHostId(); assert.notEqual(a, b);
  assert.match(a, /^urn:ietf:params:oauth:jwk-thumbprint:sha-256:[A-Za-z0-9_-]{43}$/);
});
test('private configuration rejects dynamic client IDs, invalid host IDs and unknown active account', t => {
  const state = emptyState(); state.ext_agent_host_id = 'private-user-name'; assert.throws(() => validateState(state));
  state.ext_agent_host_id = generateHostId(); state.pending_client_id = 'dynamic_agent_client'; assert.throws(() => validateState(state));
  state.pending_client_id = null; state.active_registration_id = 'missing'; assert.throws(() => validateState(state));
  assert.ok(defaultPrivateDirectory({ platform: 'win32', home: '/synthetic/home', env: { LOCALAPPDATA: '/synthetic/user-local' } }).includes('Axiom Rook'));
});
test('private store writes atomically outside checkout with owner-only Unix permissions', async t => {
  const { store } = await fixture(t); const state = await store.read(); assert.equal(state.registrations[0].subject, SUBJECT);
  if (process.platform !== 'win32') {
    assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
    assert.equal((await stat(join(store.directory, 'chatgpt-auth.json'))).mode & 0o777, 0o600);
  }
  const bad = new PrivateChatGPTStore(join(process.cwd(), 'private', 'chatgpt'));
  await assert.rejects(bad.prepare(), e => e.code === 'unsafe_storage');
});
test('private store refuses symlink credential files and credential disclosure through status', async t => {
  const { store, state, dir } = await fixture(t); const status = JSON.stringify(safeStatus(state));
  for (const secret of [CLIENT, SUBJECT, state.ext_agent_host_id, state.registrations[0].tokens.access_token]) assert.equal(status.includes(secret), false);
  await rm(join(store.directory, 'chatgpt-auth.json')); await writeFile(join(dir, 'elsewhere'), '{}');
  await symlink(join(dir, 'elsewhere'), join(store.directory, 'chatgpt-auth.json'));
  await assert.rejects(store.read(), e => e.code === 'unsafe_storage');
});
test('successful mock login saves issued client ID, validated subject and reusable host', async t => {
  const { store } = await fixture(t, { signedIn: false }); let attempt, previous;
  const auth = new ChatGPTAuth(store, { now: () => NOW, authorize: fakeAuthorize(a => { previous = attempt; attempt = a; }), fetchImpl: fakeOpenAI(async (url, options) => {
    assert.equal(url, TOKEN); assert.equal(options.method, 'POST'); assert.equal(options.body.get('grant_type'), 'authorization_code');
    assert.equal(options.body.get('client_id'), CLIENT); assert.equal(options.body.get('resource'), RESOURCE);
    assert.equal(options.body.get('code_verifier'), attempt.verifier); assert.equal(options.body.get('redirect_uri'), attempt.redirectUri);
    assert.equal(options.body.has('client_secret'), false); return json(tokenBody(await idToken(attempt.nonce)));
  }) });
  const first = await auth.login(); assert.equal(first.planUsageAuthorized, true);
  const saved = await store.read(), host = saved.ext_agent_host_id; assert.equal(saved.registrations[0].client_id, CLIENT); assert.equal(saved.registrations[0].subject, SUBJECT);
  await auth.login(); assert.equal(attempt.clientId, CLIENT); assert.notEqual(attempt.nonce, previous.nonce);
  assert.equal((await store.read()).ext_agent_host_id, host); assert.equal((await store.read()).registrations.length, 1);
});
test('ID token without granted direct scope keeps sign-in but prevents model calls', async t => {
  const { store } = await fixture(t, { signedIn: false }); let attempt;
  const auth = new ChatGPTAuth(store, { now: () => NOW, authorize: fakeAuthorize(a => { attempt = a; }),
    fetchImpl: fakeOpenAI(async url => { assert.equal(url, TOKEN); return json(tokenBody(await idToken(attempt.nonce), { scope: 'openid profile email' })); }) });
  const result = await auth.login(); assert.equal(result.signedIn, true); assert.equal(result.planUsageAuthorized, false);
  await assert.rejects(new ChatGPTClient(auth).models(), e => e.code === 'plan_disabled');
});
test('invalid login identity cannot replace the active registration or credentials', async t => {
  const { store, state } = await fixture(t); let attempt;
  const auth = new ChatGPTAuth(store, { now: () => NOW, authorize: fakeAuthorize(a => { attempt = a; }),
    fetchImpl: fakeOpenAI(async () => json(tokenBody(await idToken(attempt.nonce, { subject: 'wrong-user' })))) });
  await assert.rejects(auth.login(), e => e.code === 'invalid_identity'); assert.deepEqual(await store.read(), state);
});
test('invalid_grant on initial code retains issued ID for a fresh subsequent attempt', async t => {
  const { store } = await fixture(t, { signedIn: false }); let attempt, exchange = 0;
  const auth = new ChatGPTAuth(store, { now: () => NOW, authorize: fakeAuthorize(a => { attempt = a; }), fetchImpl: fakeOpenAI(async () => {
    if (++exchange === 1) return json({ error: 'invalid_grant' }, 400);
    return json(tokenBody(await idToken(attempt.nonce)));
  }) });
  await assert.rejects(auth.login(), e => e.code === 'invalid_grant'); assert.equal((await store.read()).pending_client_id, CLIENT);
  await auth.login(); assert.equal(attempt.clientId, CLIENT); assert.equal((await store.read()).pending_client_id, null);
});
test('token response validation uses actual granted scopes and declared lifetime', () => {
  const t = normalizeTokens(tokenBody('synthetic-id', { expires_in: 1200, scope: 'openid', earliest_refresh_at: NOW / 1000 + 100 }), NOW);
  assert.equal(t.access_expires_at, NOW + 1200000); assert.equal(t.refresh_expires_at, NOW + 30 * 86400000); assert.equal(t.earliest_refresh_at, NOW + 100000);
  assert.deepEqual(t.scopes, ['openid']); assert.deepEqual(normalizeTokens(tokenBody('id', { scope: undefined }), NOW).scopes, []);
  for (const changes of [{ token_type: 'Basic' }, { expires_in: -1 }, { access_token: 'bad token' }, { earliest_refresh_at: 'invalid' }]) assert.throws(() => normalizeTokens(tokenBody('id', changes), NOW), e => e.code === 'invalid_tokens');
});
test('near-expiry refresh atomically rotates tokens and keeps account identity', async t => {
  const { store } = await fixture(t, { expires: NOW + 30000 });
  const auth = new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async (url, options) => {
    if (url === TOKEN) {
      assert.equal(options.body.get('grant_type'), 'refresh_token'); assert.equal(options.body.get('client_id'), CLIENT);
      assert.equal(options.body.get('refresh_token'), 'synthetic-refresh'); assert.equal(options.body.has('scope'), false);
      return json(tokenBody(await idToken(), { access_token: 'rotated-access', refresh_token: 'rotated-refresh' }));
    }
    assert.equal(url, `${RESOURCE}/models`); assert.equal(options.headers.Authorization, 'Bearer rotated-access'); return json(modelList);
  }) });
  await new ChatGPTClient(auth).models(); const r = (await store.read()).registrations[0];
  assert.equal(r.tokens.refresh_token, 'rotated-refresh'); assert.equal(r.tokens.access_expires_at, NOW + 3600000); assert.equal(r.subject, SUBJECT);
});
test('separate store instances serialize refresh so a rotating token is used once', async t => {
  const { store } = await fixture(t, { expires: NOW + 30000 }); let refreshes = 0;
  const fetchImpl = fakeOpenAI(async url => {
    if (url === TOKEN) { refreshes++; await new Promise(resolve => setTimeout(resolve, 30)); return json(tokenBody(await idToken(), { refresh_token: 'rotated-refresh' })); }
    assert.equal(url, `${RESOURCE}/models`); return json(modelList);
  });
  const a = new ChatGPTClient(new ChatGPTAuth(store, { fetchImpl, now: () => NOW }));
  const b = new ChatGPTClient(new ChatGPTAuth(new PrivateChatGPTStore(store.directory), { fetchImpl, now: () => NOW }));
  await Promise.all([a.models(), b.models()]); assert.equal(refreshes, 1);
});
test('terminal refresh error clears tokens, retaining issued registration and host', async t => {
  const { store, state } = await fixture(t, { expires: NOW + 30000 });
  const auth = new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async () => json({ error: 'refresh_token_reused' }, 400)) });
  await assert.rejects(new ChatGPTClient(auth).models(), e => e.code === 'refresh_token_reused');
  const saved = await store.read(); assert.equal(saved.registrations[0].tokens, null); assert.equal(saved.registrations[0].client_id, CLIENT); assert.equal(saved.ext_agent_host_id, state.ext_agent_host_id);
});
test('temporary refresh failure retains credentials and never logs provider body', async t => {
  const { store, state } = await fixture(t, { expires: NOW + 30000 });
  const auth = new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async () => json({ detail: 'synthetic-private-diagnostic' }, 503)) });
  await assert.rejects(new ChatGPTClient(auth).models(), e => { assert.equal(e.status, 503); assert.equal(formatSafeError(e).includes('synthetic-private-diagnostic'), false); return true; });
  assert.deepEqual(await store.read(), state);
});
test('refresh cannot switch subject and will not proceed with ungranted plan scope', async t => {
  const { store, state } = await fixture(t, { expires: NOW + 30000 });
  const bad = new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async () => json(tokenBody(await idToken(undefined, { subject: 'other' })))) });
  await assert.rejects(new ChatGPTClient(bad).models(), e => e.code === 'invalid_identity'); assert.deepEqual(await store.read(), state);
  const disabled = new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async () => json(tokenBody(await idToken(), { scope: 'openid' }))) });
  await assert.rejects(new ChatGPTClient(disabled).models(), e => e.code === 'plan_disabled'); assert.deepEqual((await store.read()).registrations[0].tokens.scopes, ['openid']);
});
test('model discovery displays only list visibility, server order and server slugs', () => {
  assert.deepEqual(filterModels(modelList), [{ slug: 'synthetic-model', display_name: 'Synthetic model' }]);
  assert.throws(() => filterModels({ data: [] })); assert.deepEqual(filterModels({ models: [] }), []);
});
test('selected model is saved privately and unavailable selection has no fallback', async t => {
  const { store } = await fixture(t);
  const client = new ChatGPTClient(new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async url => { assert.equal(url, `${RESOURCE}/models`); return json(modelList); }) }));
  await client.selectModel('synthetic-model'); assert.equal((await store.read()).registrations[0].selected_model, 'synthetic-model');
  await assert.rejects(client.selectModel('hidden-model'), e => e.code === 'model_unavailable');
});
test('manual input includes all approved layers; private context stays excluded even with approval', () => {
  const layers = ['identity', 'behavior_history', 'memory', 'continuity'];
  const records = layers.map((layer, i) => contextRecord({ id: `synthetic-${i}`, layer }));
  records.push(contextRecord({ id: 'private', visibility: 'private', text: 'PRIVATE-CONTEXT-MUST-NOT-LEAVE' }));
  records.push(contextRecord({ id: 'unapproved', approvedForExternalUse: false, text: 'UNAPPROVED-CONTEXT' }));
  const body = manualResponseBody('synthetic-model', records), serialized = JSON.stringify(body);
  for (const layer of layers) assert.ok(serialized.includes(layer));
  assert.equal(serialized.includes('PRIVATE-CONTEXT-MUST-NOT-LEAVE'), false); assert.equal(serialized.includes('UNAPPROVED-CONTEXT'), false);
  assert.deepEqual(Object.keys(body).sort(), ['input', 'model', 'store', 'stream']); assert.equal(body.store, false); assert.equal(body.stream, true);
  assert.equal(body.input.some(i => i.role === 'system'), false);
});
test('manual Responses call uses bearer token, exact endpoint, approved input and completion', async t => {
  const { store } = await fixture(t); let calls = 0;
  const client = new ChatGPTClient(new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-access');
    if (url === `${RESOURCE}/models`) return json(modelList);
    assert.equal(url, `${RESOURCE}/responses`); assert.equal(options.method, 'POST'); calls++;
    const body = JSON.parse(options.body); assert.equal(body.model, 'synthetic-model'); assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.deepEqual(Object.keys(body).sort(), ['input', 'model', 'store', 'stream']);
    assert.equal(options.body.includes('PRIVATE-SENTINEL'), false);
    return sse([{ type: 'response.output_text.delta', delta: 'synthetic-answer' }, completed('synthetic-answer')]);
  }) }));
  const result = await client.test({ manual: true, records: [contextRecord({ visibility: 'private', text: 'PRIVATE-SENTINEL' })] });
  assert.equal(result.completed, true); assert.equal(result.text, 'synthetic-answer'); assert.equal(calls, 1);
});
test('missing explicit manual intent, invalid consent and unavailable model prevent inference', async t => {
  const { store } = await fixture(t); let calls = 0;
  const client = new ChatGPTClient(new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async url => { calls++; assert.equal(url, `${RESOURCE}/models`); return json({ models: [] }); }) }));
  await assert.rejects(client.test(), e => e.code === 'manual_only'); assert.equal(calls, 0);
  await assert.rejects(client.test({ manual: true, records: [contextRecord({ approvedForExternalUse: undefined })] }), e => e.code === 'invalid_input'); assert.equal(calls, 0);
  await assert.rejects(client.test({ manual: true }), e => e.code === 'model_unavailable'); assert.equal(calls, 1);
});
test('SSE parser handles byte-split UTF-8, comments, CRLF and completed output', async () => {
  const encoded = new TextEncoder().encode(`: keepalive\r\n\r\ndata: ${JSON.stringify({ type: 'response.output_text.delta', delta: 'ğü' })}\r\n\r\ndata: ${JSON.stringify(completed('ğü'))}\r\n\r\n`);
  const stream = new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3)); controller.close(); } });
  assert.equal((await consumeResponseStream(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }))).text, 'ğü');
});
test('stream failures, incomplete responses and disconnected streams are separate; partial output is not success', async () => {
  const delta = { type: 'response.output_text.delta', delta: 'unconfirmed-partial' };
  for (const [events, code] of [
    [[delta, { type: 'response.failed', response: { error: { code: 'synthetic_unknown' } } }], 'stream_failed'],
    [[delta, { type: 'response.incomplete', response: { status: 'incomplete' } }], 'stream_incomplete'],
    [[delta], 'stream_interrupted']
  ]) await assert.rejects(consumeResponseStream(sse(events)), e => e.code === code);
  const broken = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(delta)}\n\n`)); c.error(new Error('synthetic connection reset')); } });
  await assert.rejects(consumeResponseStream(new Response(broken, { headers: { 'Content-Type': 'text/event-stream' } })), e => e.code === 'stream_interrupted');
});
test('usage limits are distinguished before and during stream; no automatic retry', async t => {
  const code = 'subscription_sharing_usage_limit_exceeded';
  await assert.rejects(consumeResponseStream(json({ error: { code } }, 429)), e => e.code === code && e.status === 429);
  await assert.rejects(consumeResponseStream(sse([{ type: 'response.failed', response: { error: { code } } }])), e => e.code === code);
  const { store } = await fixture(t); let responses = 0;
  const client = new ChatGPTClient(new ChatGPTAuth(store, { now: () => NOW, fetchImpl: fakeOpenAI(async url => {
    if (url === `${RESOURCE}/models`) return json(modelList); responses++; return json({ error: { code } }, 429);
  }) }));
  await assert.rejects(client.test({ manual: true }), e => e.code === code); assert.equal(responses, 1);
});
test('direct admission errors preserve safe status/shape without printing diagnostic text', async () => {
  const error = providerError({ detail: 'synthetic-private-diagnostic' }, 403, 'req_synthetic');
  assert.equal(error.status, 403); assert.equal(error.bodyShape, 'detail'); assert.equal(error.requestId, 'req_synthetic');
  assert.equal(formatSafeError(error).includes('synthetic-private-diagnostic'), false);
  await assert.rejects(consumeResponseStream(json({ detail: 'synthetic-private-diagnostic' }, 503)), e => e.status === 503);
});
test('malformed streams and a false completion event are rejected', async () => {
  await assert.rejects(consumeResponseStream(new Response('data: invalid\n\n', { headers: { 'Content-Type': 'text/event-stream' } })), e => e.code === 'invalid_stream');
  await assert.rejects(consumeResponseStream(sse([{ type: 'response.completed', response: { status: 'failed' } }])), e => e.code === 'invalid_stream');
  await assert.rejects(consumeResponseStream(new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } })), e => e.code === 'stream_interrupted');
});
test('logout revokes through discovered endpoint and clears tokens without removing registration', async t => {
  const { store, state } = await fixture(t); let revocations = 0;
  const auth = new ChatGPTAuth(store, { fetchImpl: fakeOpenAI(async (url, options) => {
    assert.equal(url, discovery.revocation_endpoint); assert.equal(options.body.get('token_type_hint'), 'refresh_token');
    assert.equal(options.body.get('client_id'), CLIENT); revocations++; return new Response('', { status: 200 });
  }) });
  assert.equal((await auth.logout()).remoteRevocationConfirmed, true); assert.equal(revocations, 1);
  const saved = await store.read(); assert.equal(saved.registrations[0].tokens, null); assert.equal(saved.ext_agent_host_id, state.ext_agent_host_id); assert.equal(saved.registrations[0].client_id, CLIENT);
});
test('logout retries bounded transient errors and reports unconfirmed revocation while clearing locally', async t => {
  const { store } = await fixture(t); let calls = 0;
  const auth = new ChatGPTAuth(store, { fetchImpl: fakeOpenAI(async () => { calls++; return json({ detail: 'synthetic-unavailable' }, 503); }) });
  const result = await auth.logout(); assert.equal(result.remoteRevocationConfirmed, false); assert.equal(calls, 3);
  assert.equal((await store.read()).registrations[0].tokens, null); assert.ok(result.recovery.includes('ChatGPT Settings'));
});
test('local account switching keeps issued IDs, token sets and model selections separate', async t => {
  const { store, state } = await fixture(t);
  state.registrations.push({ ...structuredClone(state.registrations[0]), id: 'second-account', label: 'Account 2', client_id: 'oaiapp_other', subject: 'other-subject', selected_model: null });
  await store.withLock(() => store.write(state)); const auth = new ChatGPTAuth(store);
  const status = await auth.useAccount('Account 2'); assert.equal(status.activeAccount, 'Account 2'); assert.equal(status.selectedModel, null);
  const saved = await store.read(); assert.equal(saved.registrations[0].client_id, CLIENT); assert.equal(saved.registrations[1].subject, 'other-subject');
});
test('status CLI performs no external requests and exposes no tokens or registration identifiers', async t => {
  const { store, state } = await fixture(t); const output = [];
  await runChatGPTCommand('chatgpt-status', [], { store, output: text => output.push(text), authOptions: { fetchImpl: async () => { throw new Error('No network allowed'); } } });
  const text = output.join('\n'); assert.equal(text.includes(CLIENT), false); assert.equal(text.includes(SUBJECT), false);
  assert.equal(text.includes(state.ext_agent_host_id), false); assert.equal(text.includes('synthetic-access'), false);
  await assert.rejects(runChatGPTCommand('chatgpt-login', ['--unknown'], { store, output: () => {} }), e => e.code === 'invalid_config');
});
test('redaction removes tokens, OAuth URL hints, personal identifiers and nested secrets', () => {
  const email = ['synthetic-user', 'invalid.test'].join('@');
  const value = { access_token: 'synthetic-secret', refresh_token: 'synthetic-refresh', id_token: 'synthetic-id', client_id: CLIENT,
    subject: SUBJECT, email, nested: [{ authorization: 'Bearer secret', code_verifier: 'synthetic-verifier-value' }],
    diagnostic: `Bearer synthetic-secret ${email} https://auth.openai.com/path?id_token_hint=synthetic-id` };
  const safe = JSON.stringify(redactSensitive(value));
  for (const raw of ['synthetic-secret', 'synthetic-refresh', 'synthetic-id', CLIENT, SUBJECT, email, 'synthetic-verifier-value']) assert.equal(safe.includes(raw), false);
  assert.equal(formatSafeError(new Error('synthetic-secret')).includes('synthetic-secret'), false);
});
test('public checker rejects JWTs, bearer strings, assigned tokens and real registration records', () => {
  const bodies = [
    'eyJ' + 'x'.repeat(15) + '.' + 'y'.repeat(20) + '.' + 'z'.repeat(20),
    'Bearer ' + 'a'.repeat(25),
    JSON.stringify({ access_token: 'a'.repeat(30) }),
    JSON.stringify({ client_id: 'oaiapp_' + 'x'.repeat(20) })
  ];
  for (const body of bodies) assert.match(checkPublicFiles(['README.md'], () => body).join(' '), /OAuth/);
  assert.match(checkPublicFiles(['chatgpt-auth.json'], () => '{}')[0], /Unapproved/);
  assert.deepEqual(checkPublicFiles(['src/chatgpt-auth.js'], () => 'Synthetic source only'), []);
});

test('OAuth URL construction rejects invalid host IDs and non-loopback redirects', () => {
  assert.throws(() => createAttempt({ port: 12345, hostId: 'urn:uuid:personal-name' }), e => e.code === 'invalid_config');
  const a = createAttempt({ port: 12345, hostId: generateHostId() });
  assert.throws(() => authorizationUrl({ ...a, redirectUri: 'http://localhost:12345/auth/callback' }), e => e.code === 'invalid_config');
});

function mockListener() {
  const state = { handler: null, host: null, closed: 0, browserOpened: false };
  state.factory = handler => {
    state.handler = handler;
    return { once() {}, listen(port, host, ready) { assert.equal(port, 0); state.host = host; queueMicrotask(ready); },
      address() { return { port: 34567 }; }, close() { state.closed++; }, closeAllConnections() {} };
  };
  state.respond = url => {
    let status, body;
    state.handler({ method: 'GET', headers: { host: url.host }, url: url.pathname + url.search },
      { setHeader() {}, writeHead(value) { status = value; }, end(value) { body = value; } });
    return { status, body };
  };
  return state;
}
test('mock loopback listener binds before opening browser and closes after a validated callback', async () => {
  const listener = mockListener();
  const result = await loopbackAuthorization({ hostId: generateHostId() }, { createServerImpl: listener.factory, openBrowser: async raw => {
    assert.equal(listener.host, '127.0.0.1'); listener.browserOpened = true;
    const auth = new URL(raw), callback = new URL(auth.searchParams.get('redirect_uri'));
    callback.search = new URLSearchParams({ state: auth.searchParams.get('state'), code: 'synthetic-code', client_id: CLIENT });
    const response = listener.respond(callback); assert.equal(response.status, 200); assert.equal(response.body.includes('synthetic-code'), false);
  } });
  assert.equal(result.clientId, CLIENT); assert.equal(listener.browserOpened, true); assert.ok(listener.closed > 0);
});
test('mock listener closes on browser failure and expired login without touching an account', async () => {
  const failed = mockListener();
  await assert.rejects(loopbackAuthorization({ hostId: generateHostId() }, { createServerImpl: failed.factory,
    openBrowser: async () => { throw new ChatGPTError('browser_unavailable'); } }), e => e.code === 'browser_unavailable');
  assert.ok(failed.closed > 0);
  const expired = mockListener();
  await assert.rejects(loopbackAuthorization({ hostId: generateHostId() }, { createServerImpl: expired.factory, openBrowser: async () => {}, timeoutMs: 1 }), e => e.code === 'login_timeout');
  assert.ok(expired.closed > 0);
});
test('expired refresh token and earliest-refresh restriction prevent renewal requests', async t => {
  const { store, state } = await fixture(t, { expires: NOW }); let calls = 0;
  const auth = new ChatGPTAuth(store, { now: () => NOW, fetchImpl: async () => { calls++; throw new Error('No request expected'); } });
  state.registrations[0].tokens.earliest_refresh_at = NOW + 1000; await store.withLock(() => store.write(state));
  await assert.rejects(new ChatGPTClient(auth).models(), e => e.code === 'refresh_not_ready'); assert.equal(calls, 0);
  state.registrations[0].tokens.earliest_refresh_at = 0; state.registrations[0].tokens.refresh_expires_at = NOW;
  await store.withLock(() => store.write(state));
  await assert.rejects(new ChatGPTClient(auth).models(), e => e.code === 'login_required'); assert.equal(calls, 0);
});
test('missing selected model blocks catalog and inference rather than choosing a default', async t => {
  const { store, state } = await fixture(t); state.registrations[0].selected_model = null;
  await store.withLock(() => store.write(state));
  const client = new ChatGPTClient(new ChatGPTAuth(store, { now: () => NOW, fetchImpl: async () => { throw new Error('No network expected'); } }));
  await assert.rejects(client.test({ manual: true }), e => e.code === 'model_required');
});
test('new account registration activates only after verification and preserves the previous account', async t => {
  const { store, state } = await fixture(t); let attempt;
  const secondClient = 'oaiapp_second';
  const auth = new ChatGPTAuth(store, { now: () => NOW, authorize: async options => {
    assert.equal(options.registration, undefined);
    attempt = createAttempt({ ...options, port: 34567, now: NOW });
    return { ...consumeCallback(attempt, `${attempt.redirectUri}?state=${attempt.state}&code=x&client_id=${secondClient}`, NOW), attempt };
  }, fetchImpl: fakeOpenAI(async () => json(tokenBody(await idToken(attempt.nonce, { subject: 'second-user', audience: secondClient })))) });
  await auth.login({ newAccount: true }); const saved = await store.read();
  assert.deepEqual(saved.registrations[0], state.registrations[0]); assert.equal(saved.registrations[1].client_id, secondClient);
  assert.equal(saved.registrations[1].selected_model, null); assert.equal(safeStatus(saved).activeAccount, 'Account 2');
});
