import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFile, writeFile, realpath, mkdir } from 'node:fs/promises';
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRecords } from './context.js';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
function keyFrom(value) {
  if (typeof value !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error('AXIOM_VAULT_KEY must be a 32-byte hex key');
  return Buffer.from(value, 'hex');
}
async function outsideRepo(file, existing = false) {
  if (!isAbsolute(file)) throw new Error('Vault path must be absolute and outside the repository');
  // Resolve parent symlinks before checking containment.
  const target = existing ? await realpath(file) : resolve(await realpath(dirname(file)), basename(file));
  const rel = relative(await realpath(repoRoot), target);
  if (!rel || (!rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) && !isAbsolute(rel))) throw new Error('Vault must be outside repository');
  return target;
}

export async function saveVault(file, records, keyValue) {
  validateRecords(records);
  const key = keyFrom(keyValue);
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const target = await outsideRepo(file);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(records), 'utf8'), cipher.final()]);
  const envelope = { version: 1, iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: ciphertext.toString('base64') };
  // Exclusive creation: never silently overwrite a context version.
  await writeFile(target, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
}

export async function loadVault(file, keyValue) {
  const target = await outsideRepo(file, true);
  const envelope = JSON.parse(await readFile(target, 'utf8'));
  if (envelope.version !== 1 || !/^[a-f0-9]{24}$/.test(envelope.iv) || !/^[a-f0-9]{32}$/.test(envelope.tag)) throw new Error('Invalid vault envelope');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyValue), Buffer.from(envelope.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(envelope.tag, 'hex'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.data, 'base64')), decipher.final()]);
  return validateRecords(JSON.parse(plaintext.toString('utf8')));
}
