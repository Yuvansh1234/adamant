---
name: performance-review
description: Review a change to Adamant's run path (worker, agent graph, tool gateway, sandbox, model calls) for speed regressions against docs/performance.md. Use before opening a PR that touches those areas, or when asked why a run is slow.
---

# Performance review

The rules and their reasons are in [docs/performance.md](../../../docs/performance.md). This skill
applies them to a diff.

## Steps

1. Get the change: `git diff main...HEAD` (or the files you were asked about).
2. Keep only code on the run path: job pickup, fetching code, the sandbox image, log parsing,
   prompt building, model calls, tool execution, test runs, pushing.
3. Check each item below. Report only real problems in the diff, not style.

## Checklist

| Area         | Problem to look for                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Job pickup   | Polling loops or `sleep` instead of `graphile-worker` notifications                                                                   |
| Getting code | `git clone` per run instead of a mirror + `git worktree add`                                                                          |
| Dependencies | Installing per run when a lockfile-tagged image exists; network on during tests                                                       |
| Logs         | Downloading all job logs, or sending raw logs to the model without parsing                                                            |
| Prompt cache | Timestamps, run IDs, random ordering or per-run text before the last `cache_control` breakpoint; tool list that changes between calls |
| Model choice | A second model added without measurements (it loses cache hits)                                                                       |
| Edits        | Whole-file rewrites instead of the text editor tool                                                                                   |
| Tool results | Parallel tool results split across messages; unbounded tool output                                                                    |
| Tests        | Full suite on every retry instead of the failing tests first                                                                          |
| Push         | Pushing before the sandbox passes; waiting on GitHub Actions inside the fix loop                                                      |
| Timings      | New steps that don't record `started_at` / `ended_at`                                                                                 |
| Sequencing   | Independent awaits run one after another instead of `Promise.all`                                                                     |

## Output

For each problem: `file:line`, which rule it breaks, the likely cost (for example "adds a full
install to every retry"), and the fix. If nothing is wrong, say so in one line.

If the change affects fix quality as well as speed, say the evaluation set should be run before
and after (see [docs/product.md](../../../docs/product.md#roadmap)).
