import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { Sandbox } from "@e2b/code-interpreter"
import { readFileSync } from "fs"
import { basename } from "path"
import { z } from "zod"

/**
 * Custom in-process MCP tool: run_in_sandbox
 * The orchestrator calls this after code_writer finishes to execute any local
 * Python or Typescript file inside an isolated e2b sandbox and capture its output.
 */
const runInSandbox = tool(
  "run_in_sandbox",
  "Upload a local Python or Typescript file to an isolated e2b sandbox and execute it. " +
    "Returns stdout, stderr, and any execution errors. " +
    "Always call this after code_writer has finished editing a file.",
  {
    file_path: z
      .string()
      .describe("Absolute or relative path to the Python or Typescript file to run."),
    setup_code: z
      .string()
      .optional()
      .describe(
        "Optional Python or Typescript code to run before the file (e.g. install packages with pip).",
      ),
  },
  async ({ file_path, setup_code }) => {
    const sandbox = await Sandbox.create()
    try {
      if (setup_code) {
        await sandbox.runCode(setup_code)
      }

      const source = readFileSync(file_path, "utf-8")
      const sandboxPath = `/home/user/${basename(file_path)}`
      await sandbox.files.write(sandboxPath, source)

      const execution = await sandbox.runCode(
        `exec(open(${JSON.stringify(sandboxPath)}).read())`,
      )

      const stdout = execution.logs.stdout.join("\n")
      const stderr = execution.logs.stderr.join("\n")
      const errors = execution.error
        ? `Error: ${execution.error.name}: ${execution.error.value}`
        : ""

      const output = [
        stdout && `stdout:\n${stdout}`,
        stderr && `stderr:\n${stderr}`,
        errors,
      ]
        .filter(Boolean)
        .join("\n\n")

      return {
        content: [{ type: "text" as const, text: output || "(no output)" }],
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
