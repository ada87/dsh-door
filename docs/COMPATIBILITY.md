# Compatibility

Generated from [`compat.json`](../compat.json). Do not edit by hand; run `pnpm compat` in the monorepo root.

| | |
|---|---|
| Plugin | `dsh-door` **0.1.6** |
| dsh range | `>=0.2.1-rc.4 <0.3.0` |
| Protocol | 1 |
| App minimum | 0.1.0 |
| Updated | 2026-11-17 |

## Tested

| dsh | Result | Tested | Notes |
|---|---|---|---|
| `0.2.2-rc.1` | pass | 2026-11-16 | Pairing, sessions, transcript, approvals, schedules, files, terminal. |
| `0.2.2-rc.3` | pending | — | Static API review only; runtime matrix pending. |

`pass` = automated tests and a real-host smoke run; `partial` = static review only;
`pending` = not run yet; `fail` = known incompatibility.

Extra policy notes: [COMPATIBILITY-NOTES.md](COMPATIBILITY-NOTES.md).

Install: `dsh plugin --profile web add dsh-door@0.1.6`
