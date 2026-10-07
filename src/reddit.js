import { validateConfig } from './config.js';

export class RedditReader {
  #config; #token; #fetch; #nextReadAt = 0; #busy = false;
  constructor(config, token, fetchImpl = fetch, now = () => Date.now()) {
    this.#config = structuredClone(validateConfig(config)); this.#token = token; this.#fetch = fetchImpl; this.now = now;
  }
  async readComments(subreddit) {
    const c = this.#config;
    if (!c.redditAccessApproved) throw new Error('Reddit approval not recorded; no network request made');
    if (typeof this.#token !== 'string' || !this.#token.trim()) throw new Error('Approved OAuth access token required');
    if (!/^[A-Za-z0-9_]{1,30}$/.test(subreddit) || !c.allowlistedSubreddits.some(s => s.toLowerCase() === subreddit.toLowerCase())) throw new Error('Community not allowlisted');
    if (this.#busy || this.now() < this.#nextReadAt) throw new Error('Read rate limit active');
    this.#busy = true;
    this.#nextReadAt = this.now() + 60000 / c.maxReadsPerMinute;
    try {
      const response = await this.#fetch(`https://oauth.reddit.com/r/${encodeURIComponent(subreddit)}/comments?limit=25&raw_json=1`, {
        headers: { Authorization: `Bearer ${this.#token}`, 'User-Agent': 'node:axiom-rook:0.1.0 (by /u/AxiomRook)' },
        redirect: 'error', signal: AbortSignal.timeout(15000)
      });
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = Number(response.headers.get('x-ratelimit-reset'));
      const retry = response.headers.get('retry-after');
      if (response.status === 429 || (remaining !== null && Number(remaining) <= 0)) {
        const seconds = /^\d+(\.\d+)?$/.test(retry ?? '') ? Number(retry) : Math.max(60, (Date.parse(retry ?? '') - this.now()) / 1000 || 0);
        this.#nextReadAt = this.now() + Math.max(60, Number.isFinite(reset) ? reset : 60, seconds) * 1000;
      }
      if (!response.ok) throw new Error(`Reddit read failed (${response.status}); no automatic retry`);
      const data = await response.json();
      if (!Array.isArray(data?.data?.children)) throw new Error('Unexpected Reddit response');
      return data.data.children.slice(0, 25).filter(v => v.kind === 't1').map(v => ({
        id: v.data.name, subreddit: v.data.subreddit, author: v.data.author, body: v.data.body,
        deleted: v.data.author === '[deleted]' || v.data.body === '[deleted]',
        removed: v.data.body === '[removed]', locked: v.data.locked !== false
      }));
    } finally { this.#busy = false; }
  }
}
