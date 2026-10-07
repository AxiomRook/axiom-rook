import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { ChatGPTError, providerError, terminalRefreshCodes } from './chatgpt-errors.js';
import { activeRegistration, generateHostId, isHostId, safeStatus } from './chatgpt-store.js';

export const ISSUER = 'https://auth.openai.com';
export const AUTHORIZE = `${ISSUER}/api/accounts/authorize`;
export const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
export const DISCOVERY = `${ISSUER}/.well-known/openid-configuration`;
export const RESOURCE = 'https://api.openai.com/v1';
export const SCOPES = 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
const clientPattern = /^oaiapp_[A-Za-z0-9_-]{1,200}$/;
const nonceEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function fetchSafe(fetchImpl, url, options = {}) {
  try { return await fetchImpl(url, { ...options, redirect: 'error', signal: options.signal ?? AbortSignal.timeout(20000) }); }
  catch { throw new ChatGPTError('network_error'); }
}

export async function readJson(response) {
  if (!response.body) throw new ChatGPTError('provider_error', { status: response.status });
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) throw new ChatGPTError('provider_error', { status: response.status });
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError('provider_error', { status: response.status });
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchSafe(fetchImpl, url, options);
  let body;
  try { body = await readJson(response); }
  catch (error) { if (!response.ok) throw new ChatGPTError('provider_error', { status: response.status }); throw error; }
  if (!response.ok) throw providerError(body, response.status, response.headers.get('openai-request-id') ?? response.headers.get('x-request-id'));
  return body;
}

export function createAttempt({ port, hostId, registration, pendingClientId, enablePlan = false, now = Date.now() }) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ChatGPTError('invalid_config');
  if (!isHostId(hostId)) throw new ChatGPTError('invalid_config');
  const clientId = registration?.client_id ?? pendingClientId ?? 'dynamic_agent_client';
  if (clientId !== 'dynamic_agent_client' && !clientPattern.test(clientId)) throw new ChatGPTError('invalid_config');
  const verifier = randomBytes(64).toString('base64url');
  return { state: randomBytes(32).toString('base64url'), nonce: randomBytes(32).toString('base64url'), verifier,
    challenge: createHash('sha256').update(verifier).digest('base64url'), redirectUri: `http://127.0.0.1:${port}/auth/callback`,
    clientId, hostId, enablePlan, expiresAt: now + 600000, consumed: false };
}

export function authorizationUrl(attempt) {
  let redirect;
  try { redirect = new URL(attempt.redirectUri); } catch { throw new ChatGPTError('invalid_config'); }
  if (redirect.protocol !== 'http:' || redirect.hostname !== '127.0.0.1' || !redirect.port || redirect.pathname !== '/auth/callback'
    || redirect.search || redirect.hash || redirect.username || redirect.password) throw new ChatGPTError('invalid_config');
  const url = new URL(AUTHORIZE);
  url.search = new URLSearchParams({ client_id: attempt.clientId, ext_agent_host_id: attempt.hostId,
    response_type: 'code', redirect_uri: attempt.redirectUri, scope: SCOPES, resource: RESOURCE,
    state: attempt.state, nonce: attempt.nonce, code_challenge_method: 'S256', code_challenge: attempt.challenge }).toString();
  if (attempt.clientId === 'dynamic_agent_client') url.searchParams.set('agent_name_hint', 'Axiom Rook');
  // Deliberately omit ID-token/email hints: account selection stays explicit and no token is put in a URL.
  if (attempt.enablePlan) url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export function consumeCallback(attempt, callback, now = Date.now()) {
  if (attempt.consumed || attempt.expiresAt <= now) throw new ChatGPTError('invalid_state');
  attempt.consumed = true;
  let url;
  try { url = new URL(callback); } catch { throw new ChatGPTError('invalid_callback'); }
  const expected = new URL(attempt.redirectUri);
  if (url.origin !== expected.origin || url.pathname !== '/auth/callback' || url.hash || url.username || url.password) throw new ChatGPTError('invalid_callback');
  for (const key of ['state', 'code', 'client_id', 'error']) if (url.searchParams.getAll(key).length > 1) throw new ChatGPTError('invalid_callback');
  if (!nonceEqual(url.searchParams.get('state'), attempt.state)) throw new ChatGPTError('invalid_state');
  if (url.searchParams.has('error')) throw new ChatGPTError(url.searchParams.get('error') === 'access_denied' ? 'consent_denied' : 'invalid_callback');
  const code = url.searchParams.get('code'), returned = url.searchParams.get('client_id');
  if (!code || code.length > 8192 || /[\x00-\x20\x7f]/.test(code)) throw new ChatGPTError('invalid_callback');
  if (attempt.clientId === 'dynamic_agent_client') {
    if (!returned || !clientPattern.test(returned)) throw new ChatGPTError('registration_incomplete');
  } else if (returned !== null && returned !== attempt.clientId) throw new ChatGPTError('account_mismatch');
  return { code, clientId: returned ?? attempt.clientId };
}

export function openSystemBrowser(url) {
  const program = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  return new Promise((resolve, reject) => execFile(program, args, { windowsHide: true, timeout: 15000 }, error => error ? reject(new ChatGPTError('browser_unavailable')) : resolve()));
}

export async function loopbackAuthorization(options, { openBrowser = openSystemBrowser, timeoutMs = 600000, createServerImpl = createServer } = {}) {
  let attempt, finish, fail, timer, settled = false;
  const result = new Promise((resolve, reject) => { finish = resolve; fail = reject; });
  // Mark the callback promise handled while waiting for the browser opener.
  result.catch(() => {});
  const server = createServerImpl((request, response) => {
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    const expected = new URL(attempt.redirectUri);
    if (request.method !== 'GET' || request.headers.host !== expected.host || !request.url?.startsWith('/auth/callback?') || request.url.length > 16384) {
      response.writeHead(404); response.end('Not found.'); return;
    }
    if (settled) { response.writeHead(409); response.end('Sign-in attempt already handled.'); return; }
    settled = true; clearTimeout(timer);
    try {
      const callback = consumeCallback(attempt, new URL(request.url, attempt.redirectUri).toString());
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Callback received. Return to Axiom Rook for the sign-in result.');
      finish({ ...callback, attempt });
    } catch (error) { response.writeHead(400); response.end('Sign-in callback rejected. Return to Axiom Rook.'); fail(error); }
    finally { server.close(); }
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    attempt = createAttempt({ ...options, port: server.address().port });
    timer = setTimeout(() => { settled = true; server.close(); fail(new ChatGPTError('login_timeout')); }, timeoutMs);
    await openBrowser(authorizationUrl(attempt));
    return await result;
  } catch (error) {
    if (error instanceof ChatGPTError) throw error;
    throw new ChatGPTError('invalid_callback');
  } finally { settled = true; clearTimeout(timer); server.close(); server.closeAllConnections(); }
}

export class OpenAIIdentityVerifier {
  constructor(fetchImpl = fetch, now = () => Date.now()) { this.fetch = fetchImpl; this.now = now; this.cachedKeys = null; this.keysAt = 0; }
  async discovery() {
    const config = await requestJson(this.fetch, DISCOVERY);
    if (config.issuer !== ISSUER || config.authorization_endpoint !== AUTHORIZE || config.token_endpoint !== TOKEN
      || config.jwks_uri !== `${ISSUER}/.well-known/jwks.json`) throw new ChatGPTError('invalid_identity');
    return config;
  }
  async keys(force = false) {
    if (!force && this.cachedKeys && this.now() - this.keysAt < 300000) return this.cachedKeys;
    await this.discovery();
    const keys = await requestJson(this.fetch, `${ISSUER}/.well-known/jwks.json`);
    try { this.cachedKeys = createLocalJWKSet(keys); } catch { throw new ChatGPTError('invalid_identity'); }
    this.keysAt = this.now(); return this.cachedKeys;
  }
  async verify(idToken, { clientId, nonce, subject } = {}) {
    try {
      const options = { issuer: ISSUER, audience: clientId, algorithms: ['RS256', 'ES256'], requiredClaims: ['sub', 'exp', 'iat'],
        clockTolerance: 5, currentDate: new Date(this.now()) };
      let payload;
      try { ({ payload } = await jwtVerify(idToken, await this.keys(), options)); }
      catch (error) {
        if (error.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw error;
        ({ payload } = await jwtVerify(idToken, await this.keys(true), options));
      }
      if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 500
        || (nonce !== undefined && !nonceEqual(payload.nonce, nonce)) || (subject !== undefined && payload.sub !== subject)) throw new Error('Unverified identity');
      return { issuer: ISSUER, subject: payload.sub };
    } catch (error) {
      if (error instanceof ChatGPTError && error.code === 'network_error') throw error;
      throw new ChatGPTError('invalid_identity');
    }
  }
}

export function normalizeTokens(body, now = Date.now()) {
  const token = value => typeof value === 'string' && value.length > 0 && value.length <= 65536 && !/[\x00-\x20\x7f]/.test(value);
  if (!token(body?.access_token) || !token(body?.id_token) || body.token_type?.toLowerCase() !== 'bearer'
    || !Number.isInteger(body.expires_in) || body.expires_in < 1 || body.expires_in > 86400
    || (body.refresh_token !== undefined && !token(body.refresh_token)) || (body.scope !== undefined && typeof body.scope !== 'string')) throw new ChatGPTError('invalid_tokens');
  const scopes = body.scope ? [...new Set(body.scope.split(/\s+/).filter(Boolean))] : [];
  if (scopes.some(s => !/^[a-z_.]+$/.test(s))) throw new ChatGPTError('invalid_tokens');
  let earliest = 0;
  if (body.earliest_refresh_at != null) {
    earliest = typeof body.earliest_refresh_at === 'number' ? body.earliest_refresh_at * 1000 : Date.parse(body.earliest_refresh_at);
    if (!Number.isSafeInteger(earliest) || earliest < 0) throw new ChatGPTError('invalid_tokens');
  }
  return { access_token: body.access_token, refresh_token: body.refresh_token ?? null, id_token: body.id_token,
    token_type: 'Bearer', scopes, saved_at: now, access_expires_at: now + body.expires_in * 1000,
    refresh_expires_at: body.refresh_token ? now + 30 * 86400000 : 0, earliest_refresh_at: earliest };
}

export class ChatGPTAuth {
  constructor(store, { fetchImpl = fetch, now = () => Date.now(), authorize = loopbackAuthorization } = {}) {
    this.store = store; this.fetch = fetchImpl; this.now = now; this.authorize = authorize;
    this.verifier = new OpenAIIdentityVerifier(fetchImpl, now);
  }
  async login({ account, newAccount = false, enablePlan = false } = {}) {
    return this.store.withLock(async state => {
      if (account && newAccount) throw new ChatGPTError('invalid_config');
      if (account && !state.registrations.length) throw new ChatGPTError('login_required');
      if (!state.ext_agent_host_id) { state.ext_agent_host_id = generateHostId(); await this.store.write(state); }
      const registration = newAccount ? undefined : state.registrations.length ? activeRegistration(state, account ?? state.active_registration_id) : undefined;
      const result = await this.authorize({ hostId: state.ext_agent_host_id, registration,
        pendingClientId: registration ? undefined : state.pending_client_id, enablePlan });
      const { code, clientId, attempt } = result;
      let body;
      try {
        body = await requestJson(this.fetch, TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, code,
            code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, resource: RESOURCE }) });
      } catch (error) {
        if (error.code === 'invalid_grant' && !registration) { state.pending_client_id = clientId; await this.store.write(state); }
        throw error;
      }
      const tokens = normalizeTokens(body, this.now());
      const identity = await this.verifier.verify(tokens.id_token, { clientId, nonce: attempt.nonce, subject: registration?.subject });
      if (registration && registration.client_id !== clientId) throw new ChatGPTError('account_mismatch');
      let selected = registration ?? state.registrations.find(r => r.client_id === clientId && r.subject === identity.subject);
      if (!selected) {
        if (state.registrations.length >= 20) throw new ChatGPTError('invalid_config');
        selected = { id: randomUUID(), label: `Account ${state.registrations.length + 1}`, client_id: clientId,
          issuer: identity.issuer, subject: identity.subject, selected_model: null, tokens: null };
        state.registrations.push(selected);
      }
      selected.tokens = tokens; state.active_registration_id = selected.id; state.pending_client_id = null;
      await this.store.write(state); return safeStatus(state);
    });
  }
  async ensureAccess(state) {
    const registration = activeRegistration(state), tokens = registration.tokens;
    if (!tokens) throw new ChatGPTError('login_required');
    if (!tokens.scopes.includes('chatgpt.tokens.use.direct')) throw new ChatGPTError('plan_disabled');
    if (tokens.access_expires_at > this.now() + 60000) return registration;
    if (!tokens.refresh_token || tokens.refresh_expires_at <= this.now()) {
      registration.tokens = null; await this.store.write(state); throw new ChatGPTError('login_required');
    }
    if (tokens.earliest_refresh_at > this.now()) {
      if (tokens.access_expires_at > this.now() + 5000) return registration;
      throw new ChatGPTError('refresh_not_ready');
    }
    let body;
    try {
      body = await requestJson(this.fetch, TOKEN, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: registration.client_id, refresh_token: tokens.refresh_token, resource: RESOURCE }) });
    } catch (error) {
      if (terminalRefreshCodes.has(error.code)) { registration.tokens = null; await this.store.write(state); }
      throw error;
    }
    const replacement = normalizeTokens(body, this.now());
    if (!replacement.refresh_token) throw new ChatGPTError('invalid_tokens');
    await this.verifier.verify(replacement.id_token, { clientId: registration.client_id, subject: registration.subject });
    registration.tokens = replacement; await this.store.write(state);
    if (!replacement.scopes.includes('chatgpt.tokens.use.direct')) throw new ChatGPTError('plan_disabled');
    return registration;
  }
  async useAccount(account) {
    return this.store.withLock(async state => { const r = activeRegistration(state, account); state.active_registration_id = r.id; await this.store.write(state); return safeStatus(state); });
  }
  async logout({ account } = {}) {
    return this.store.withLock(async state => {
      const registration = activeRegistration(state, account ?? state.active_registration_id);
      let remoteRevocationConfirmed = !registration.tokens?.refresh_token;
      try {
        if (registration.tokens?.refresh_token) {
          const config = await this.verifier.discovery(); const endpoint = new URL(config.revocation_endpoint);
          if (endpoint.origin !== ISSUER || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new ChatGPTError('invalid_identity');
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              const response = await fetchSafe(this.fetch, endpoint.toString(), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: registration.tokens.refresh_token, token_type_hint: 'refresh_token', client_id: registration.client_id }) });
              remoteRevocationConfirmed = response.status === 200; await response.body?.cancel();
              if (remoteRevocationConfirmed || response.status < 500) break;
            } catch (error) { if (error.code !== 'network_error') break; }
            if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
          }
        }
      } catch { /* Local sign-out still completes; the caller reports unconfirmed revocation. */ }
      registration.tokens = null; await this.store.write(state);
      return { signedOut: true, account: registration.label, remoteRevocationConfirmed,
        ...(remoteRevocationConfirmed ? {} : { recovery: 'Disconnect Axiom Rook in ChatGPT Settings to confirm remote revocation.' }) };
    });
  }
}
