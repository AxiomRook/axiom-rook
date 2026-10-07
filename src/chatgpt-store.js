import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ChatGPTError } from './chatgpt-errors.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const hostPattern = /^(?:urn:uuid:[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}|urn:ietf:params:oauth:jwk-thumbprint:sha-256:[A-Za-z0-9_-]{43})$/;
const clientPattern = /^oaiapp_[A-Za-z0-9_-]{1,200}$/;
export const isHostId = value => typeof value === 'string' && hostPattern.test(value);
const isText = (value, limit = 65536) => typeof value === 'string' && value.length > 0 && value.length <= limit && !/[\x00-\x20\x7f]/.test(value);
const isTime = value => Number.isSafeInteger(value) && value >= 0;
const within = (base, target) => { const r = relative(base, target); return !r || (!isAbsolute(r) && r !== '..' && !r.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)); };

export function generateHostId() {
  // RFC 7638 canonical public JWK -> RFC 9278 URI. No identifying data or private key is persisted.
  const { publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return `urn:ietf:params:oauth:jwk-thumbprint:sha-256:${createHash('sha256').update(canonical).digest('base64url')}`;
}

export function defaultPrivateDirectory({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (env.AXIOM_CHATGPT_DIR) return env.AXIOM_CHATGPT_DIR;
  return platform === 'win32' ? join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Axiom Rook', 'chatgpt')
    : join(home, '.config', 'axiom-rook', 'chatgpt');
}

export function emptyState() {
  return { version: 1, ext_agent_host_id: null, active_registration_id: null, pending_client_id: null, registrations: [] };
}

export function validateState(state) {
  const invalid = () => { throw new ChatGPTError('invalid_config'); };
  if (!state || state.version !== 1 || !Array.isArray(state.registrations) || state.registrations.length > 20) invalid();
  if (state.ext_agent_host_id !== null && !hostPattern.test(state.ext_agent_host_id)) invalid();
  if (state.pending_client_id !== null && !clientPattern.test(state.pending_client_id)) invalid();
  const ids = new Set(), mappings = new Set();
  for (const r of state.registrations) {
    if (!r || !isText(r.id, 100) || ids.has(r.id) || !/^Account [1-9]\d*$/.test(r.label) || !clientPattern.test(r.client_id)
      || r.issuer !== 'https://auth.openai.com' || !isText(r.subject, 500)) invalid();
    const mapping = `${r.client_id}\0${r.subject}`;
    if (mappings.has(mapping)) invalid(); ids.add(r.id); mappings.add(mapping);
    if (r.selected_model !== null && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(r.selected_model)) invalid();
    if (r.tokens !== null) {
      const t = r.tokens;
      if (!isText(t.access_token) || !isText(t.id_token) || (t.refresh_token !== null && !isText(t.refresh_token))
        || t.token_type !== 'Bearer' || !isTime(t.access_expires_at) || !isTime(t.refresh_expires_at) || !isTime(t.saved_at)
        || !isTime(t.earliest_refresh_at) || !Array.isArray(t.scopes) || t.scopes.some(s => !/^[a-z_.]+$/.test(s))) invalid();
    }
  }
  if (state.active_registration_id !== null && !ids.has(state.active_registration_id)) invalid();
  if (state.registrations.length && state.ext_agent_host_id === null) invalid();
  return state;
}

export function activeRegistration(state, id = state.active_registration_id) {
  const r = state.registrations.find(r => r.id === id || r.label === id);
  if (!r) throw new ChatGPTError('login_required');
  return r;
}

export function safeStatus(state) {
  const active = state.registrations.find(r => r.id === state.active_registration_id);
  return {
    signedIn: Boolean(active?.tokens), activeAccount: active?.label ?? null,
    planUsageAuthorized: Boolean(active?.tokens?.scopes.includes('chatgpt.tokens.use.direct')),
    selectedModel: active?.selected_model ?? null,
    accessExpiresAt: active?.tokens ? new Date(active.tokens.access_expires_at).toISOString() : null,
    accounts: state.registrations.map(r => ({ label: r.label, active: r.id === state.active_registration_id, signedIn: Boolean(r.tokens) })),
    chatgptHistoryImported: false, redditPostingImplemented: false, backgroundAutomationEnabled: false
  };
}

export class PrivateChatGPTStore {
  constructor(directory = defaultPrivateDirectory(), { root = repoRoot, lockTimeoutMs = 5000 } = {}) {
    this.directory = directory; this.root = root; this.lockTimeoutMs = lockTimeoutMs;
  }
  async prepare(create = true) {
    if (!isAbsolute(this.directory)) throw new ChatGPTError('unsafe_storage');
    if (process.platform === 'win32' && !within(resolve(homedir()), resolve(this.directory))) throw new ChatGPTError('unsafe_storage');
    const base = await realpath(this.root);
    const requested = resolve(this.directory);
    if (within(base, requested)) throw new ChatGPTError('unsafe_storage');
    let ancestor = requested;
    while (true) {
      try { await lstat(ancestor); break; } catch (error) {
        if (error.code !== 'ENOENT' || dirname(ancestor) === ancestor) throw new ChatGPTError('storage_failure');
        ancestor = dirname(ancestor);
      }
    }
    const canonical = resolve(await realpath(ancestor), relative(ancestor, requested));
    if (within(base, canonical)) throw new ChatGPTError('unsafe_storage');
    if (!create) { try { await lstat(requested); } catch (error) { if (error.code === 'ENOENT') return null; throw new ChatGPTError('storage_failure'); } }
    else await mkdir(requested, { recursive: true, mode: 0o700 });
    const info = await lstat(requested);
    if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid())) throw new ChatGPTError('unsafe_storage');
    if (process.platform !== 'win32') await chmod(requested, 0o700);
    const directory = await realpath(requested);
    if (within(base, directory)) throw new ChatGPTError('unsafe_storage');
    return directory;
  }
  async read() {
    const directory = await this.prepare(false);
    if (!directory) return emptyState();
    const file = join(directory, 'chatgpt-auth.json');
    try {
      const info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024
        || (process.getuid && info.uid !== process.getuid()) || (process.platform !== 'win32' && (info.mode & 0o077))) throw new ChatGPTError('unsafe_storage');
      const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      try { return validateState(JSON.parse(await handle.readFile('utf8'))); } finally { await handle.close(); }
    } catch (error) {
      if (error.code === 'ENOENT') return emptyState();
      if (error instanceof ChatGPTError) throw error;
      throw new ChatGPTError('storage_failure');
    }
  }
  async write(state) {
    validateState(state);
    const directory = await this.prepare();
    const temp = join(directory, `.${randomUUID()}.tmp`);
    try {
      const handle = await open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(state), 'utf8'); await handle.sync(); } finally { await handle.close(); }
      await rename(temp, join(directory, 'chatgpt-auth.json'));
    } catch { throw new ChatGPTError('storage_failure'); }
    finally { await rm(temp, { force: true }); }
  }
  async withLock(fn) {
    const directory = await this.prepare();
    const lock = join(directory, '.session.lock');
    const owner = randomUUID(), started = Date.now();
    while (true) {
      try {
        await mkdir(lock, { mode: 0o700 });
        const handle = await open(join(lock, 'owner.json'), 'wx', 0o600);
        try { await handle.writeFile(JSON.stringify({ pid: process.pid, owner })); } finally { await handle.close(); }
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw new ChatGPTError('storage_failure');
        // Recover only an old lock owned by a confirmed dead local process; never steal a live refresh.
        try {
          const info = await lstat(lock);
          if (info.isDirectory() && !info.isSymbolicLink() && Date.now() - info.mtimeMs > 120000) {
            const previous = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
            if (Number.isSafeInteger(previous.pid) && previous.pid > 0) {
              try { process.kill(previous.pid, 0); } catch (e) { if (e.code === 'ESRCH') { await rm(lock, { recursive: true }); continue; } }
            }
          }
        } catch { /* A live or incomplete lock is left alone. */ }
        if (Date.now() - started >= this.lockTimeoutMs) throw new ChatGPTError('storage_busy');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    }
    try { return await fn(await this.read()); }
    finally {
      const current = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
      if (current.owner === owner) await rm(lock, { recursive: true });
    }
  }
}
