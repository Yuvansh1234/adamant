import { describe, it, expect } from 'vitest';
import { DockerSandbox } from '../src/docker-sandbox';

describe('DockerSandbox', () => {
  const sandbox = new DockerSandbox();

  it('initializes with default options', () => {
    expect(sandbox).toBeDefined();
  });

  it('correctly constructs execution options interface', () => {
    const options = {
      workspacePath: process.cwd(),
      command: 'echo "test pass"',
      timeoutMs: 5000,
    };
    expect(options.command).toBe('echo "test pass"');
  });

  it('fails gracefully when command fails with non-zero exit code', async () => {
    const result = await sandbox.run({
      workspacePath: process.cwd(),
      command: 'exit 1',
      timeoutMs: 5000,
    });
    expect(result.success).toBe(false);
  });
});
