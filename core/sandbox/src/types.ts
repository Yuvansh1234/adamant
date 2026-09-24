export interface SandboxExecutionOptions {
  /** Path to the workspace/directory to mount and test */
  workspacePath: string
  /** Test command to execute inside container (e.g. 'pnpm test' or 'npm test') */
  command: string
  /** Max execution time in milliseconds before killing the container (default: 60000ms) */
  timeoutMs?: number
  /** Docker image to use (default: 'node:20-alpine') */
  image?: string
  /** Memory limit (default: '1g') */
  memoryLimit?: string
  /** CPU quota limit (default: '1.0') */
  cpuLimit?: string
  /** Custom environment variables (excluding secrets) */
  env?: Record<string, string>
}

export interface SandboxResult {
  /** True if command finished with exit code 0 and did not time out */
  success: boolean
  /** Process exit code, or null if killed */
  exitCode: number | null
  /** Standard output captured from the container */
  stdout: string
  /** Standard error captured from the container */
  stderr: string
  /** Indicates whether the container was terminated due to timeout */
  timedOut: boolean
  /** Execution duration in milliseconds */
  durationMs: number
}
