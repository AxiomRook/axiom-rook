# Security and private data

Never put real credentials, private conversations, personal data, context exports or memory logs in this repository, issues, pull requests or CI output. Contact the account owner privately for sensitive reports; use public issues only for non-sensitive defects. A private security-reporting channel has not been configured.

The vault requires a separate 32-byte AES key supplied in `AXIOM_VAULT_KEY`. Keep the key in a private secret store, separately from encrypted data and backups. The code does not generate, display, save or recover your key. Losing it makes the vault unreadable. Windows file-mode flags do not establish a Windows ACL: use an operator-only folder and OS permissions. Encryption protects stored data, not a compromised process or machine.

Vault files must have absolute paths outside the repository. Saving uses exclusive creation, so each version should use a new filename; the operator owns version retention and backups. No private vault is created automatically. Repository history and a private vault's version history are separate.

The external-context filter rejects private or unapproved records. Public approval is a deliberate disclosure decision; review the text itself, not just the label. Do not derive or store sensitive characteristics of Reddit users, match Reddit identities to off-platform identities, or train models on Reddit data.

Reddit content is untrusted input. A future model must receive it as quoted discussion data, with no tools that can access secrets, private files or settings. Never let a comment change context approvals, permissions, allowlists or publishing decisions. The SIWC model path accepts only a fixed manually initiated synthetic test and explicitly approved operator context; it has no tools and is not connected to Reddit input.

The public-file checker uses an explicit file allowlist and common token/email patterns. It is an additional guard, not a guarantee of anonymization or secret detection. Review every changed file before publication. `.gitignore` cannot remove data that was already committed. If a credential is exposed, revoke it first, then remove it from history using a separately reviewed process.

SIWC credentials and account mappings must remain in protected local user storage outside the Git checkout. Never run real sign-in in a managed cloud workspace. Unix directories use mode 0700 and credential files 0600; writes are atomic and symlink credential files are rejected. On Windows, use the local profile directory with user-controlled OS permissions; chmod alone is not an ACL guarantee. The integration has not been tested on Windows or with a real account.

Only the OpenAI authorization, token/discovery/JWKS and discovered same-origin revocation endpoints handle OAuth data. The browser callback binds only to 127.0.0.1 and displays no code or tokens. OpenAI requests disable redirects. ID-token verification uses the locked jose library. Account hints are omitted from authorization URLs so no retained ID token is logged or placed in a URL.

SIWC never uses an OpenAI API key or silently changes billing. Token refresh happens only within explicit CLI actions, is serialized across local processes, and rotates the stored set together. Sign-out clears local tokens while retaining the account/client mapping and host identity; unconfirmed remote revocation is reported. No other user's activity may directly trigger the connected user's plan use.

Production prerequisites include Reddit approval and app labeling, OAuth setup, approved model data handling, explicit community scope, persistent rate/deduplication controls, current deletion/block checks before every reply, bounded data retention, audit records without raw private text, and an operator kill switch. Posting remains unimplemented until these are resolved.
