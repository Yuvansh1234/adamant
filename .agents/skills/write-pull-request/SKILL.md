---
name: write-pull-request
description: Write commit messages, pull request titles and pull request descriptions for this repo, and open the PR with gh. Use whenever you commit, open or update a PR, or are asked to describe a change. Produces short, specific, verified descriptions with no filler.
---

# Writing pull requests

A reviewer should understand what changed, why, and how it was checked in under a minute. Write
for a teammate who knows the codebase but hasn't seen this change.

## Steps

1. **Read the whole change.** `git diff main...HEAD` and `git log main..HEAD --oneline`. Describe
   what the diff does, not what you intended or remember doing.
2. **Run the checks** from AGENTS.md (`pnpm typecheck`, `pnpm lint`, `pnpm build`, and
   `pnpm format:check` on the files you touched). Note which you ran and what happened.
3. **Write the title** (rules below).
4. **Fill in `.github/pull_request_template.md`.** Delete sections that don't apply instead of
   writing "N/A".
5. **Open the PR:** `gh pr create --base main --title "<title>" --body-file <file>`. Use `--draft`
   if any check fails or the work is incomplete, and say so in the body.

## Title

- Imperative, specific, at most 72 characters:
  `Fix renderer path after moving packages to electron/`.
- No type prefixes, no emoji, no trailing period.
- PRs are squash-merged, so the title becomes the commit subject on `main`. Make it read well in
  `git log`.

## Body

**What and why**: 1–3 sentences. Start with the effect on users or developers, then the reason.
Link the issue (`Closes #12`).

**How I tested it**: the commands you actually ran and their result, plus anything checked by
hand. If you didn't test something, say so.

**Notes for reviewers**: only when there's something worth their attention: a risky area, a
trade-off you made, a follow-up you deliberately left out, a screenshot for UI changes.

Most PRs need under 150 words. Longer is fine for design changes, as long as every sentence carries
information.

## Rules

- **Only claim what you verified.** Never write "tested", "works", "no breaking changes" or
  "fully backwards compatible" unless you checked. Say exactly what you checked.
- **Don't narrate the diff.** GitHub already lists the changed files. Explain decisions the diff
  doesn't show.
- **Be concrete.** Name the function, file, command or error. "Improves reliability" says nothing;
  "retries the webhook ACK once on a 502" does.
- **Mention what's missing:** known limitations, skipped cases, follow-ups.
- **Plain language.** Short sentences. Explain an acronym the first time unless every reviewer
  knows it.

Don't use:

- Filler openers: "This PR aims to", "This PR introduces", "In this PR, we".
- Inflated words: comprehensive, robust, seamless, enhance, leverage, streamline, delve, crucial,
  cutting-edge, elevate, empower.
- Emoji headings, bold on every other phrase, or a "Key changes" list of trivial edits.
- Closing summaries that repeat the body, or praise of the change ("This significantly improves…").
- Headings for sections with one line of content.

## Commit messages

- Subject: imperative, at most 72 characters, no trailing period:
  `Repoint workspace paths to electron/`.
- Body when the reason isn't obvious: a blank line, then why the change was needed, wrapped at 72
  columns.
- One logical change per commit. Keep any attribution trailer your tool is configured to add.

## Example

Bad:

> ## 🚀 Summary
>
> This PR introduces comprehensive improvements to the build configuration, ensuring a seamless
> developer experience. **Key changes:** updated `tsconfig.json`, updated `eslint.config.mjs`,
> updated `package.json`… These changes significantly enhance maintainability.

Good:

> **Fix build after moving packages to electron/**
>
> The last commit moved `packages/*` to `electron/*` but left the workspace, tsconfig, ESLint,
> dev script and electron-builder pointing at `packages/`, so `pnpm dev` and `pnpm build` failed.
> The packaged app also loaded its UI from the old `renderer/dist` path.
>
> **How I tested it:** `pnpm typecheck`, `pnpm lint` and `pnpm build` pass. Checked that
> `electron/main/dist` resolves the preload script and `electron/adamant/dist/index.html`. Didn't
> launch the packaged app.
>
> **Notes:** `pnpm install` dropped Tailwind from the lockfile; it was never in `package.json`.
