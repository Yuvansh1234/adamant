import { spawn } from 'node:child_process';
import type { SandboxExecutionOptions, SandboxResult } from './types';

export class DockerSandbox {
  private defaultImage: string;
  private defaultTimeoutMs: number;

  constructor(options?: { defaultImage?: string; defaultTimeoutMs?: number }) {
    this.defaultImage = options?.defaultImage ?? 'node:20-alpine';
    this.defaultTimeoutMs = options?.defaultTimeoutMs ?? 60000;
  }

  /**
   * Executes a command within an isolated ephemeral Docker container.
   */
  async run(options: SandboxExecutionOptions): Promise<SandboxResult> {
    const startTime = Date.now();
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    const image = options.image ?? this.defaultImage;
    const memoryLimit = options.memoryLimit ?? '1g';
    const cpuLimit = options.cpuLimit ?? '1.0';

    const dockerArgs: string[] = [
      'run',
      '--rm',
      '--network',
      'none',
      '--memory',
      memoryLimit,
      '--cpus',
      cpuLimit,
      '-v',
      `${options.workspacePath}:/workspace:ro`,
      '-w',
      '/workspace',
    ];

    if (options.env) {
      for (const [key, value] of Object.entries(options.env)) {
        dockerArgs.push('-e', `${key}=${value}`);
      }
    }

    dockerArgs.push(image, 'sh', '-c', options.command);

    return new Promise<SandboxResult>((resolve) => {
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = spawn('docker', dockerArgs);

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
      }, timeoutMs);

      proc.stdout?.on('data', (data: Buffer | string) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer | string) => {
        stderr += data.toString();
      });

      proc.on('error', (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          exitCode: 1,
          stdout,
          stderr: stderr + `\nFailed to start docker process: ${err.message}`,
          timedOut: false,
          durationMs: Date.now() - startTime,
        });
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({
          success: !timedOut && code === 0,
          exitCode: code,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
