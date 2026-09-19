# Product direction

What Adamant does, who it is for, and what we build first. The backend design is in
[backend-architecture.md](backend-architecture.md), the stack in [tech-stack.md](tech-stack.md),
and speed work in [performance.md](performance.md).

## The job

**When CI goes red, Adamant works out why and hands back a fix it has proven works**, as a pull
request that a human reviews and GitHub merges.

We deliberately do not build a general "fix anything" coding agent. That puts us head to head with
Copilot, Claude Code, Codex and Cursor, which developers already have in their editors. A narrower
job suits Adamant better:

- **No prompt needed.** The failing check describes the task, and a webhook starts the run.
- **Success is easy to check.** The build goes green or it doesn't. That is what makes an AI fix
  believable.
- **It happens often and it's annoying:** lint and type errors, snapshot drift, broken dependency
  upgrades, config drift.

**Lead scenario: Dependabot and Renovate PRs that fail CI.** Every team has a backlog of them, the
fixes are usually mechanical (renamed APIs, changed types), and "we made your 14 stale Dependabot
PRs pass" is a pitch anyone understands.

Nearby products: Nx Cloud's self-healing CI, Gitar and GitHub Copilot Autofix. The space is real but
not empty, so trust is how we stand out.

## Trust features

Developers are tired of AI-generated PRs. Adamant only gets adopted if its PRs are clearly safe to
review.

### 1. Sort the failure before patching

| Category                       | What Adamant does                                                          |
| ------------------------------ | -------------------------------------------------------------------------- |
| Lint / type error              | Patch                                                                      |
| Test assertion                 | Patch, with the test-weakening guard on                                    |
| Build or config                | Patch                                                                      |
| Dependency upgrade             | Patch call sites; never pin back silently                                  |
| Flaky test                     | `rerun_failed_jobs`; if the rerun passes, label it flaky and touch no code |
| Infra (runner outage, secrets) | Report the cause, don't patch                                              |

This step prevents most bad PRs and wasted runs.

### 2. Reproduce before fixing

The sandbox must show the failure before Adamant writes a patch. If it can't reproduce the failure,
Adamant says so instead of guessing. Every PR then shows the same tests failing before and passing
after.

### 3. Never weaken tests to make them pass

Flag, and by default block, any diff that:

- deletes a test or adds `.skip` / `.only` / `xit`
- changes an expected value in an assertion
- adds `@ts-ignore`, `@ts-expect-error`, `eslint-disable` or `as any`
- loosens a type or a lint rule in config

A reviewer can still accept one of these, but only by explicitly acknowledging it.

### 4. Keep diffs small

Set a maximum diff size per repo and warn when files unrelated to the failure change.

### 5. Evidence in every PR

Adamant's PR description always has the same short shape:

1. **Cause:** two sentences.
2. **Evidence:** the relevant lines from the failing log.
3. **Fix:** what changed and why.
4. **Verified:** tests before and after, with the commands run.
5. **Not checked:** anything it did not verify.

The same no-filler rules apply as for our own PRs (see
[`.agents/skills/write-pull-request`](../.agents/skills/write-pull-request/SKILL.md)).

### 6. Give up honestly

When `diagnose_attempts` runs out, post a comment with the likely cause, where to look and what was
tried. A good diagnosis with no fix still helps, and it builds trust.

### 7. Advertise the security model

"It can't merge, can't force-push, never sees your secrets, and every command is logged" belongs
on the landing page, not only in the docs.

## Useful within 10 minutes of installing

- **Install the GitHub App, pick repos, done.** Work out how to install and run tests from the
  repo's own `.github/workflows/*.yml` instead of asking users.
- **Replay recent failures.** On install, rerun the last ~10 failed CI runs and show what Adamant
  would have done. Users see value right away, and it's our best demo.
- **`.adamant.yml` per repo:**
  - branches to watch
  - whether runs start automatically or manually
  - which failure categories to fix
  - paths it must never touch (migrations, auth, infra)
  - maximum diff size
  - monthly budget cap

## The desktop app

Reviewers already work on GitHub, so the app has to offer something a PR page can't:

- **An inbox of failed builds across all repos**, grouped by a failure fingerprint so one broken
  `main` doesn't start 30 runs.
- **A live view of each run**: every step, tool call and sandbox log as it happens.
- **One review screen** with the diff, the log lines and the before/after test results together.
- **Local mode**: fix a failure in the checkout the developer already has open, in seconds (see
  [performance.md](performance.md#local-mode)).
- **Metrics** (below).

Approvals should also work outside the app: a `/adamant approve` comment on the PR, and a desktop
notification when a fix is ready.

## Learning from reviews

When someone rejects a fix or asks for changes, save the reason per repo ("we use vitest", "never
bump major versions", "don't touch `legacy/`") and feed it into planning on the next run.

## Metrics

| Metric                      | Why                                      |
| --------------------------- | ---------------------------------------- |
| Fix acceptance rate         | The main number: are the fixes any good? |
| Time to green               | How much waiting Adamant saves           |
| Runs by failure category    | Where to invest next                     |
| Give-ups with useful triage | Value even when there's no fix           |
| Cost per accepted fix       | Model and sandbox spend                  |

## Roadmap

| Phase          | Scope                                                                                                                                                                                                                                                          |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0. Unblock** | Working build. An **evaluation set**: ~20 deliberately broken commits in a sample TypeScript repo (type error, renamed API after a dependency bump, snapshot drift, flaky test, missing env var). Measure the fix rate on every change, before tuning prompts. |
| **1. MVP**     | One stack (Node/TypeScript). A user clicks Heal on a failing PR; Adamant sorts the failure, reproduces it, patches, verifies, shows the evidence and opens a PR.                                                                                               |
| **2. V1**      | Webhook-triggered runs, flaky-test detection, grouping by fingerprint, the test-weakening guard, `.adamant.yml`, evidence-first PR descriptions, local mode.                                                                                                   |
| **3. V2**      | Dependabot fixer, replaying failures on install, metrics dashboard, memory from reviews, approval by PR comment.                                                                                                                                               |

## Out of scope for now

GitLab and Bitbucket, languages other than TypeScript, an IDE plugin, a chat UI, production error
tracking, and any form of auto-merge.

## Validating the idea

Every IT-314 team has CI that breaks. Before building a feature, ask 5–10 of them when their build
last broke and how long it took to fix, then install Adamant on their repos. Their answers decide
which failure categories we handle first.
