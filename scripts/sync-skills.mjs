/**
 * Copies the agent skills in `.agents/skills` (read by Codex and Cursor) to `.claude/skills`
 * (read by Claude Code), so each skill is written once. A copy rather than a symlink, because
 * Git for Windows checks symlinks out as plain files by default.
 *
 * `--check` changes nothing and exits non-zero when the two trees differ.
 */
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = fileURLToPath(new URL('../.agents/skills', import.meta.url))
const target = fileURLToPath(new URL('../.claude/skills', import.meta.url))

if (process.argv.includes('--check')) {
  const stale = findDifferences(source, target)
  if (stale.length > 0) {
    console.error(`.claude/skills is out of date: ${stale.join(', ')}\nRun \`pnpm skills:sync\`.`)
    process.exit(1)
  }
  console.log('.claude/skills is up to date')
} else {
  rmSync(target, { recursive: true, force: true })
  cpSync(source, target, { recursive: true })
  console.log('Synced .agents/skills -> .claude/skills')
}

/** Paths that exist on only one side, or whose contents differ. */
function findDifferences(a, b) {
  const left = listFiles(a)
  const right = listFiles(b)
  return [...new Set([...left, ...right])].filter(
    (path) =>
      !left.has(path) ||
      !right.has(path) ||
      !readFileSync(join(a, path)).equals(readFileSync(join(b, path))),
  )
}

function listFiles(dir) {
  if (!existsSync(dir)) return new Set()
  return new Set(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(dir, join(entry.parentPath, entry.name))),
  )
}
