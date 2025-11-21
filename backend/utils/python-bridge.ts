import { spawn } from "node:child_process";

interface RunPythonOptions {
  timeoutMs?: number;
}

export async function runPythonCode(
  code: string,
  input: unknown,
  options: RunPythonOptions = {},
): Promise<string> {
  const configured = process.env.PYTHON_BIN ?? "python";
  const candidates = Array.from(
    new Set([configured, "python3"]) // try configured, then python3
  );

  let lastError: unknown;
  for (const pythonBin of candidates) {
    try {
      return await executeWithPythonBin(pythonBin, code, input, options);
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      const codeProp = (err as any)?.code;
      const isNotFound =
        codeProp === "ENOENT" || message.includes("Executable not found");
      if (!isNotFound) {
        throw err;
      }
      // else: try next candidate
    }
  }
  throw new Error(
    `Python executable not found. Tried: ${candidates.join(
      ", ",
    )}. Set PYTHON_BIN in your environment.`,
  );
}

function executeWithPythonBin(
  pythonBin: string,
  code: string,
  input: unknown,
  options: RunPythonOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ["-c", code]);

    let stdout = "";
    let stderr = "";
    let timeoutHandle: NodeJS.Timeout | null = null;

    if (options.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`Python process timed out after ${options.timeoutMs}ms`));
      }, options.timeoutMs);
    }

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on("close", (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`Python exited with code ${code}: ${stderr || stdout}`));
      }
    });

    if (input !== undefined) {
      child.stdin.write(JSON.stringify(input));
    }
    child.stdin.end();
  });
}

