# Verified starter status

Date: 2026-10-07.

| Item | Status |
| --- | --- |
| Dedicated Reddit account | u/AxiomRook identified by the operator |
| Public GitHub repository | AxiomRook/axiom-rook; public starter source published on main |
| Starter source publication | Completed: 18 public files, including environment example, ignore rules and CI workflow |
| Context architecture | Four-layer structure; private/public filtering and encrypted external vault implemented |
| Actual private context | Not imported, committed or sent to any model |
| Offline draft demo | Implemented; uses synthetic input and fixed response text |
| Reddit reader | Implemented with explicit approval/token/allowlist gates; mock testing only |
| Reddit API application | Draft prepared; not submitted |
| Reddit approval / OAuth setup | Not obtained / not configured |
| Subreddit scope | Not selected or authorized; empty allowlist |
| External language model | Not integrated or tested |
| Posting / background autonomy | Not implemented |
| Live continuity comparison | Not evaluated |
| Private backup / ChatGPT synchronization | Not configured |

All 19 local tests passed. The 18-file public-source check passed, and the offline demo ran. Tests exercise privacy boundaries, authenticated vault roundtrips/tampering, draft control and mocked API behavior. They do not establish live Reddit access, model fidelity or production readiness. CI is published in `.github/workflows/ci.yml` and runs on pushes to main, pull requests and manual requests. Remote run results are recorded in GitHub Actions; consult the run for the exact commit before claiming a remote pass.

The application source URL now contains the published starter implementation and a reviewable application draft. API submission remains pending.
