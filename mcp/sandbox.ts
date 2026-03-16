import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { Sandbox } from "@e2b/code-interpreter"
import { readFileSync } from "fs"
import { basename, extname } from "path"
import { z } from "zod"

type E2BLanguage = "python" | "javascript" | "typescript"

const EXT_TO_LANGUAGE: Record<string, E2BLanguage> = {
  ".py": "python",
  ".js": "javascript",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".mts": "typescript",
  ".tsx": "typescript",
  ".jsx": "javascript",
}

function resolveLanguage(filePath: string): E2BLanguage | null {
  return EXT_TO_LANGUAGE[extname(filePath).toLowerCase()] ?? null
}

const runInSandbox = tool(
  "run_in_sandbox",
  "Upload a local file to an isolated e2b sandbox and execute it. " +
    "Supports Python (.py), JavaScript (.js/.mjs/.jsx), and TypeScript (.ts/.mts/.tsx). " +
    "Returns the runtime used, stdout, stderr, and any execution errors.",
  {
    file_path: z
      .string()
      .describe("Absolute or relative path to the file to run."),
    setup_command: z
      .string()
      .optional()
      .describe(
        "Optional shell command to run before execution (e.g. 'pip install pandas' or 'npm install axios').",
      ),
  },
  async ({ file_path, setup_command }) => {
    const language = resolveLanguage(file_path)
    if (!language) {
      const supported = Object.keys(EXT_TO_LANGUAGE).join(", ")
      return {
        content: [
          {
            type: "text" as const,
            text: `Unsupported file extension "${extname(file_path)}". Supported: ${supported}`,
          },
        ],
      }
    }

    const sandbox = await Sandbox.create()
    try {
      if (setup_command) {
        await sandbox.commands.run(setup_command)
      }

      const source = readFileSync(file_path, "utf-8")
      const sandboxPath = `/home/user/${basename(file_path)}`
      await sandbox.files.write(sandboxPath, source)

      const execution = await sandbox.runCode(source, { language })

      const stdout = execution.logs.stdout.join("\n")
      const stderr = execution.logs.stderr.join("\n")
      const errors = execution.error
        ? `Error: ${execution.error.name}: ${execution.error.value}`
        : ""

      const parts = [
        `runtime: ${language}`,
        stdout && `stdout:\n${stdout}`,
        stderr && `stderr:\n${stderr}`,
        errors,
      ]
        .filter(Boolean)
        .join("\n\n")

      return {
        content: [{ type: "text" as const, text: parts || "(no output)" }],
      }
    } finally {
      await sandbox.kill()
    }
  },
)

export const sandboxMcpServer = createSdkMcpServer({
  name: "sandbox-tools",
  tools: [runInSandbox],
})
