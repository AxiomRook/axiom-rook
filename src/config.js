import { readFile } from 'node:fs/promises';

export function validateConfig(c) {
  if (c.account !== 'AxiomRook' || typeof c.redditAccessApproved !== 'boolean') throw new Error('Invalid account or access status');
  for (const k of ['allowlistedSubreddits', 'blockedUsers']) {
    if (!Array.isArray(c[k]) || c[k].some(v => typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,30}$/.test(v))) throw new Error(`Invalid ${k}`);
  }
  for (const [k, limit] of [['maxReadsPerMinute', 6], ['maxDraftsPerDay', 5], ['cooldownSeconds', 86400], ['draftTtlHours', 24]]) {
    if (!Number.isInteger(c[k]) || c[k] < 1 || c[k] > limit) throw new Error(`Invalid ${k}`);
  }
  if (c.cooldownSeconds < 600) throw new Error('Cooldown must be at least 600 seconds');
  if (typeof c.disclosure !== 'string' || !c.disclosure.includes('AI') || c.disclosure.length > 200) throw new Error('AI disclosure required');
  return c;
}

export async function loadConfig(path = new URL('../config/default.json', import.meta.url)) {
  return validateConfig(JSON.parse(await readFile(path, 'utf8')));
}
