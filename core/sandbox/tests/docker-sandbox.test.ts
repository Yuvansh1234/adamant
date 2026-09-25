import { describe, it } from "node:test";
import * as assert from "node:assert";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { DockerSandbox } from "../src/docker-sandbox.js";
import type { SpawnFunction } from "../src/types.js";

interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: () => boolean;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => true;
  return proc;
}

describe("DockerSandbox", () => {
  it("rejects non-absolute workspacePath before shelling out", async () => {
    const sandbox = new DockerSandbox();
    const result = await sandbox.run({
      workspacePath: "relative/path/dir",
      command: "echo test",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, null);
    assert.strictEqual(result.reason, "INVALID_WORKSPACE");
    assert.match(result.stderr, /Path must be absolute/);
  });

  it("constructs hardened security arguments correctly", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];

    const mockSpawn: SpawnFunction = (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      const proc = createMockProcess();
      process.nextTick(() => proc.emit("close", 0));
      return proc as unknown as ChildProcess;
    };

    const sandbox = new DockerSandbox({ spawnFn: mockSpawn });
    const absPath = process.cwd();

    const result = await sandbox.run({
      workspacePath: absPath,
      command: "pnpm test",
      runId: "eval-42",
      memoryLimit: "512m",
      cpuLimit: "0.5",
      pidsLimit: "50",
      user: "1000:1000",
    });

    assert.strictEqual(result.success, true);
    assert.strictEqual(capturedCmd, "docker");
    assert.ok(capturedArgs.includes("--cap-drop"));
    assert.ok(capturedArgs.includes("ALL"));
    assert.ok(capturedArgs.includes("--security-opt"));
    assert.ok(capturedArgs.includes("no-new-privileges"));
    assert.ok(capturedArgs.includes("--pids-limit"));
    assert.ok(capturedArgs.includes("50"));
    assert.ok(capturedArgs.includes("--user"));
    assert.ok(capturedArgs.includes("1000:1000"));
    assert.ok(capturedArgs.some(a => a.startsWith("type=bind,src=")));
    assert.ok(capturedArgs.includes("node:22-bookworm-slim"));
  });

  it("handles infra failure distinctly from test failure", async () => {
    const mockSpawn: SpawnFunction = () => {
      const proc = createMockProcess();
      process.nextTick(() => proc.emit("error", new Error("ENOENT: docker not found")));
      return proc as unknown as ChildProcess;
    };

    const sandbox = new DockerSandbox({ spawnFn: mockSpawn });
    const result = await sandbox.run({
      workspacePath: process.cwd(),
      command: "test",
    });

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.exitCode, null);
    assert.strictEqual(result.reason, "INFRA_FAILURE");
  });
});
