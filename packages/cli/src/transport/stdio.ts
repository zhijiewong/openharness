import { spawn } from "node:child_process";
import { platform } from "node:os";
import type { BridgeEnvelope, InputEnvelope, RequestEnvelope, ResponseEnvelope } from "../protocol.js";

type SpawnOptions = {
  command?: string;
  args?: string[];
};

function getDefaultCommand(): string {
  if (process.env.OH_PYTHON) {
    return process.env.OH_PYTHON;
  }
  return platform() === "win32" ? "py" : "python3";
}

function getDefaultArgs(): string[] {
  const cmd = getDefaultCommand();
  // Windows py launcher needs -3 flag; python3 does not
  if (cmd === "py") {
    return ["-3", "-m", "oh.bridge"];
  }
  return ["-m", "oh.bridge"];
}

function spawnBridge(options?: SpawnOptions) {
  const command = options?.command ?? getDefaultCommand();
  const args = options?.args ?? getDefaultArgs();
  return spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export async function sendBridgeRequest(
  request: RequestEnvelope,
  options?: SpawnOptions,
): Promise<ResponseEnvelope> {
  const child = spawnBridge(options);

  let stdout = "";
  let stderr = "";

  child.stdin.write(`${JSON.stringify(request)}\n`);
  child.stdin.end();

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `Bridge exited with code ${code}`));
    });
    child.on("error", reject);
  });

  const lines = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

  for (const line of lines) {
    try {
      return JSON.parse(line) as ResponseEnvelope;
    } catch {
      // Skip non-JSON lines (e.g., Python warnings, deprecation notices)
      continue;
    }
  }

  throw new Error(
    `Bridge returned no valid JSON.\nstdout: ${stdout.slice(0, 500)}${stderr ? `\nstderr: ${stderr.slice(0, 500)}` : ""}`,
  );
}

export async function streamBridgeRequest(
  request: RequestEnvelope,
  onEvent: (event: BridgeEnvelope) => void | InputEnvelope | Promise<void | InputEnvelope>,
  options?: SpawnOptions,
): Promise<void> {
  const child = spawnBridge(options);

  let stdout = "";
  let stderr = "";
  let processing = Promise.resolve();

  child.stdin.write(`${JSON.stringify(request)}\n`);

  const processLine = async (line: string): Promise<void> => {
    let event: BridgeEnvelope;
    try {
      event = JSON.parse(line) as BridgeEnvelope;
    } catch {
      // Skip non-JSON lines (Python warnings, tracebacks, etc.)
      return;
    }
    const response = await onEvent(event);
    if (response) {
      child.stdin.write(`${JSON.stringify(response)}\n`);
    }
  };

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();

    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      processing = processing.then(() => processLine(trimmed));
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    child.on("exit", async (code) => {
      try {
        // Chain any trailing partial line into the serialized processing queue
        const trailing = stdout.trim();
        if (trailing) {
          processing = processing.then(() => processLine(trailing));
        }
        await processing;
      } catch (error) {
        reject(error);
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr.trim() || `Bridge exited with code ${code}`));
    });
    child.on("error", reject);
  });
}
