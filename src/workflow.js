import { createHash } from 'node:crypto';
import { validateConfig } from './config.js';
import { buildExternalContext } from './context.js';

const normalize = s => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const hash = s => createHash('sha256').update(s).digest('hex');

export class DraftWorkflow {
  #config; #drafts = new Map(); #history = [];
  constructor(config, now = () => Date.now()) {
    this.#config = structuredClone(validateConfig(config)); this.now = now;
  }
  create(comment, candidate, records = []) {
    const c = this.#config, time = this.now();
    this.purge();
    if (!comment || !/^t1_[a-z0-9]+$/.test(comment.id) || typeof comment.author !== 'string' || !comment.author || typeof comment.subreddit !== 'string') throw new Error('Invalid comment');
    if (!c.allowlistedSubreddits.some(s => normalize(s) === normalize(comment.subreddit))) throw new Error('Community not allowlisted');
    if (normalize(comment.author) === normalize(c.account) || c.blockedUsers.some(u => normalize(u) === normalize(comment.author))) throw new Error('Self or blocked author');
    if (comment.deleted !== false || comment.removed !== false || comment.locked !== false) throw new Error('Comment unavailable or status unknown');
    if (typeof candidate !== 'string' || !candidate.trim() || candidate.length > 8000) throw new Error('Invalid draft');
    if (this.#history.some(h => time - h.time < c.cooldownSeconds * 1000)) throw new Error('Cooldown active');
    if (this.#history.filter(h => time - h.time < 86400000).length >= c.maxDraftsPerDay) throw new Error('Daily draft cap');
    const candidateHash = hash(normalize(candidate));
    if (this.#history.some(h => h.commentId === comment.id || h.candidateHash === candidateHash)) throw new Error('Duplicate draft');
    const body = `${candidate.trim()}\n\n${c.disclosure}`;
    const draft = { id: hash(`${comment.id}:${time}:${body}`), commentId: comment.id, body, createdAt: time, expiresAt: time + c.draftTtlHours * 3600000, state: 'pending_review', bodyHash: hash(body), context: buildExternalContext(records) };
    this.#drafts.set(draft.id, structuredClone(draft));
    this.#history.push({ time, commentId: comment.id, candidateHash });
    return structuredClone(draft);
  }
  approve(id, expectedBodyHash) {
    this.purge();
    const d = this.#drafts.get(id);
    if (!d || d.state !== 'pending_review' || d.bodyHash !== expectedBodyHash) throw new Error('Review mismatch or expired draft');
    d.state = 'reviewed'; return structuredClone(d);
  }
  purge() {
    const t = this.now();
    for (const [id, d] of this.#drafts) if (d.expiresAt <= t) this.#drafts.delete(id);
    this.#history = this.#history.filter(h => t - h.time < 86400000);
  }
  publish() {
    // Intentionally no Reddit write implementation in this initial release.
    throw new Error('Posting is not implemented; review does not authorize API publication');
  }
}
