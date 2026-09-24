<!--
Title: imperative, specific, at most 72 characters. It becomes the commit subject on main.
Keep this short: say what a reviewer can't see in the diff. Delete sections that don't apply.
-->

## What and why

<!-- 1–3 sentences: the effect on users or developers, then the reason. Link the issue: Closes #123 -->

## How I tested it

<!-- Tick only what you ran. Add anything you checked by hand, and anything you didn't test. -->

- [ ] `pnpm typecheck`
- [ ] `pnpm lint`
- [ ] `pnpm build`
- [ ] `pnpm format:check` (files I touched)

## Notes for reviewers

<!-- Risky areas, trade-offs, deliberate follow-ups, screenshots for UI changes. Delete if empty. -->

## Checklist

- [ ] The security rules in AGENTS.md still hold (IPC surface, renderer, credentials, agent tools)
- [ ] Run-path changes follow docs/performance.md
- [ ] Docs updated if behaviour or architecture changed
- [ ] If an AI agent wrote any of this, I've read and understood every line
