# Performance

How Adamant gets a fix to a developer quickly. The goal is to feel as fast as an editor agent like
Cursor, within the limits of proving every fix in a sandbox.

Cursor is fast because it works on the developer's machine: files are on disk, dependencies are
installed, and a person is watching, so it can make a small edit and run one test. Adamant's cloud
loop (fetch → install → container → tests → PR) can't match that, so we do two things:

1. A **local mode** that runs on the developer's checkout.
2. A **cloud loop** with the slow steps removed or cached.

The language and HTTP framework don't matter for speed. Time goes to installing dependencies,
running tests, model calls and waiting on people.

## Targets

Starting targets, to revise once we have real timings:

| Measure                          | Target  |
| -------------------------------- | ------- |
| Job picked up after trigger      | < 1 s   |
| Diagnosis visible in the app     | < 30 s  |
| Verified fix, cloud (warm image) | < 3 min |
| Verified fix, local mode         | < 30 s  |

## Local mode

The desktop app runs the same `@adamant/agent` package as the cloud worker (see
[tech-stack.md](tech-stack.md#planned-layout)), pointed at the checkout the developer has open.

- **No fetch, install or container start.** The code and dependencies are already there.
- **Only the failing tests run**, with the developer's own toolchain.
- **The fix lands in the working tree or a new local branch.** The developer reviews and pushes it.
- **Same command allowlist as the cloud**, and each command is shown before it runs, because it
  executes on the developer's machine.
- **Model calls go through the Adamant API**, so no API key ships inside the app. This matches the
  rule that credentials are never stored in Electron.

Cloud mode stays the automatic, sandboxed path triggered by webhooks.

## Cloud loop

### Job pickup

`graphile-worker` wakes workers with Postgres `LISTEN/NOTIFY` instead of polling on a timer, so a
job starts within milliseconds. Keep at least one worker of each kind running.

### Getting the code

Don't clone per run.

- Keep one bare mirror per repo on each worker: `git clone --mirror` once (add
  `--filter=blob:none` for large repos).
- Per run: `git fetch`, then `git worktree add --detach <path> <sha>`. Remove the worktree when the
  run ends.
- Evict mirrors that haven't been used recently when disk runs low.

### Dependencies and the sandbox image

Installing dependencies is usually the slowest step, so do it once per lockfile, not once per run.

- Build one image per repo, tagged with a hash of its lockfile(s) and toolchain version. Rebuild
  only when that hash changes.
- Build it ahead of time: on each push to the default branch (a webhook we already receive), so the
  image is warm before the first failure.
- Mount a read-only package cache (for example the pnpm store) for anything the image misses.
- The rule that tests run with the network off is unchanged. Prebuilt images make it easier to
  keep.

### Finding the cause

Give the model everything it needs in one prompt instead of letting it explore step by step.

- **Download only the failed jobs' logs.** Strip ANSI colours and timestamps.
- **Parse the log in code first:** the first error, stack traces, `file:line` references and
  failing test names. Send those lines, not the whole log.
- **Include the diff since the last green commit** (`git diff <last_green>..<red_sha>`). Most CI
  breaks come from something that just changed, so this often locates the cause without any
  searching.
- **Include the files named in stack traces** and their tests.
- **Fingerprint the failure** (normalised error message + test name + file). Runs with the same
  fingerprint are grouped: one broken `main` must not start a run on every PR that inherits it.

### Model calls

- **One model, effort set per step.** Claude Opus 5 with `output_config.effort: "low"` for sorting
  the failure and `"high"` for writing the patch (try `"xhigh"` and measure). The prompt cache
  belongs to one model, so splitting steps across models (for example Haiku for triage) loses cache
  hits. Measure before splitting.
- **Prompt caching.** The cache matches on the start of the prompt, in the order tools → system →
  messages. Keep tool definitions, the system prompt and repo context identical and first on every
  call. Put anything that changes per run (timestamps, run IDs, log lines) after the last
  `cache_control` breakpoint. Check `usage.cache_read_input_tokens`: if it stays at zero, something
  in the start of the prompt is changing.
- **Edit, don't rewrite.** Use Anthropic's text editor tool (`text_editor_20250728`, name
  `str_replace_based_edit_tool`) so the model outputs only the changed lines. Output tokens are the
  slow part of a model call.
- **Parallel tool calls.** When the model asks for several tools at once, run them concurrently and
  return all results in a single message. Splitting them teaches the model to stop calling in
  parallel.
- **Stream** every call, so the app can show progress.
- **Fast mode for local mode.** Opus 5's fast mode generates output up to 2.5× faster at twice the
  price ($10/$50 per million input/output tokens vs $5/$25). It is a research preview, available
  only on Anthropic's own API, and switching speed invalidates the prompt cache. Use it where
  someone is waiting, not for background runs.

### Verifying the fix

- **While retrying, run only the failing tests** named in the CI log (for example `vitest run -t`,
  `jest -t`, `pytest -k`).
- **Run the full suite once**, after the targeted tests pass and before review.
- Give each sandbox job a time limit and treat a timeout as a failed attempt.

### Pushing

Push the agent branch **once, after the sandbox passes**. Pushing every attempt starts a full
GitHub Actions run each time, which wastes CI minutes and can trigger preview deploys. Don't wait on
Actions inside the fix loop; the sandbox is the fast check and Actions confirms afterwards.

### Retries

- `diagnose_attempts` stays capped.
- Later: try 2–3 candidate fixes in parallel sandboxes, keep the first that passes, cancel the rest.
  This costs more but cuts the time spent retrying one fix after another.

## Feeling fast

A lot of Cursor's speed is about what the user sees.

- Show the diagnosis as soon as it exists, before the fix is verified.
- Show each step live: graph node, tool call, sandbox output.
- Show the proposed diff labelled "verifying…" while tests run.
- Send a desktop notification when a fix is ready. Waiting for a human is often the slowest step,
  so also accept `/adamant approve` as a PR comment.

## Measuring

You can't speed up what you don't measure.

- Record `started_at` and `ended_at` for every graph step and sandbox job in `audit_events`, with
  the attempt number.
- Show a per-run timing breakdown in the run view.
- Track p50 and p90 per step each week against the targets above.
- Run the evaluation set (see [product.md](product.md#roadmap)) before and after any speed change,
  so a faster run that fixes less gets noticed.

## Checklist for changes to the run path

Use this when reviewing code in the worker, agent or sandbox. The `performance-review` agent skill
applies it.

- [ ] No fresh `git clone` per run; mirrors plus worktrees
- [ ] No dependency install per run when a lockfile-tagged image exists
- [ ] Only failed-job logs downloaded; parsed before reaching the model
- [ ] Stable prompt start: nothing per-run before the last cache breakpoint
- [ ] Edits via the text editor tool, not whole-file rewrites
- [ ] Parallel tool results returned in one message
- [ ] Targeted tests during retries; full suite once
- [ ] Push only after the sandbox passes
- [ ] New steps record their timings
