import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { relative, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const allowed = new Set([
  '.gitignore', '.env.example', 'package.json', 'package-lock.json', 'README.md', 'SECURITY.md',
  'LICENSE', 'config/default.json', 'src/config.js', 'src/context.js', 'src/vault.js', 'src/workflow.js', 'src/reddit.js', 'src/cli.js',
  'scripts/check-public.js', 'test/core.test.js', '.github/workflows/ci.yml',
  'src/chatgpt-errors.js', 'src/chatgpt-store.js', 'src/chatgpt-auth.js', 'src/chatgpt-client.js', 'src/chatgpt-cli.js',
  'test/chatgpt.test.js', 'docs/chatgpt-plan-sharing.md',
  'docs/architecture.md', 'docs/reddit-application.md', 'docs/status.md'
]);
export function checkPublicFiles(files, read) {
  const failures = [];
  for (const file of files) {
    if (!allowed.has(file)) { failures.push(`Unapproved public path: ${file}`); continue; }
    const body = read(file);
    const privateKeyPattern = new RegExp(['-----BEGIN ', '.*PRIVATE KEY', '-----'].join(''));
    if (/(?:sk-proj-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/.test(body) || privateKeyPattern.test(body)) failures.push(`Possible credential: ${file}`);
    // JWTs, bearer credentials, assigned OAuth tokens and serialized real registration records are private.
    const jwt = new RegExp(['eyJ[A-Za-z0-9_-]{8,}', '\\.[A-Za-z0-9_-]{10,}', '\\.[A-Za-z0-9_-]{10,}'].join(''));
    const bearer = new RegExp(['Bearer', '\\s+[A-Za-z0-9._~-]{20,}'].join(''));
    const assignedToken = new RegExp(['["\\\']?(?:access_token|refresh_token|id_token)["\\\']?', '\\s*[:=]\\s*["\\\'][A-Za-z0-9._~-]{20,}["\\\']'].join(''), 'i');
    const registration = new RegExp(['["\\\'](?:client_id|subject|ext_agent_host_id)["\\\']', '\\s*:\\s*["\\\'](?:oaiapp_|urn:uuid:|urn:ietf:params:oauth:jwk-thumbprint:)[A-Za-z0-9:_-]{12,}'].join(''));
    if (jwt.test(body) || bearer.test(body) || assignedToken.test(body) || registration.test(body)) failures.push(`Possible OAuth credential or registration: ${file}`);
    if (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(body)) failures.push(`Email address: ${file}`);
  }
  return failures;
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['.git', 'node_modules'].includes(e.name)) return [];
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) return [relative(root, p).replaceAll('\\', '/')];
    return e.isDirectory() ? walk(p) : [relative(root, p).replaceAll('\\', '/')];
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = [...new Set([...tracked, ...walk(root)])];
  const errors = checkPublicFiles(files, file => readFileSync(join(root, file), 'utf8'));
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(`Public-source check passed (${files.length} files). Content review is still required.`);
}
