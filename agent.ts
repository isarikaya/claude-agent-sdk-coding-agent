import 'dotenv/config'

import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk"
import { Sandbox } from "@e2b/code-interpreter"
import { readFileSync } from "fs"
import { basename } from "path"
import { z } from "zod"

// ---------------------------------------------------------------------------
// Custom in-process MCP tool: run_in_sandbox
// The orchestrator calls this after code_writer finishes to execute any local
// Python or Typescript file inside an isolated e2b sandbox and capture its output.
// ---------------------------------------------------------------------------
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
      // Run optional setup (pip installs, etc.)
      if (setup_code) {
        await sandbox.runCode(setup_code)
      }

      // Upload the local file into the sandbox, preserving its original filename
      const source = readFileSync(file_path, "utf-8")
      const sandboxPath = `/home/user/${basename(file_path)}`
      await sandbox.files.write(sandboxPath, source)

      // Execute the file
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

const mcpServer = createSdkMcpServer({ name: "sandbox-tools", tools: [runInSandbox] })

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
for await (const message of query({
  prompt: "https://refactoring.guru/design-patterns/factory-method look up the factory method example in the documentation and create a minimal example in the factory.ts file. To verify that the code is working in the factory.ts file, type console.log and tell me the output.",
  options: {
    model: "claude-haiku-4-5",
    permissionMode: "acceptEdits",
    allowedTools: ["Read", "Glob", "Grep", "Agent", "mcp__sandbox-tools__run_in_sandbox"],
    mcpServers: { "sandbox-tools": mcpServer },
    agents: {
      researcher: {
        description:
          "A specialist research agent. Give it a clear research question and it " +
          "will search the web, fetch relevant pages, and return a structured " +
          "summary with sources.",
        prompt:
          "You are an expert researcher. When given a topic or question:\n" +
          "1. Run targeted WebSearch queries to find authoritative sources.\n" +
          "2. Fetch the most relevant pages with WebFetch.\n" +
          "3. Synthesise the information into a concise, well-structured report.\n" +
          "4. Always cite your sources (title + URL) at the end.\n" +
          "Return only the final report — do not include internal reasoning.",
        tools: ["WebSearch", "WebFetch", "Grep", "Glob", "Read"],
      },
      code_writer: {
        description:
          "A specialist coding agent. Give it a task description and optionally " +
          "existing file paths to modify. It will read relevant files, write or " +
          "edit code, and report what it changed.",
        prompt:
          "You are an expert software engineer. When given a coding task:\n" +
          "1. Read all relevant files before making any changes.\n" +
          "2. Write clean, well-structured code that follows existing conventions in the codebase.\n" +
          "3. Make the smallest diff possible — only change what is necessary.\n" +
          "4. After writing, re-read the files you changed to verify correctness.\n" +
          "5. Return a concise summary of every file changed and why.",
        tools: ["Read", "Write", "Edit", "Glob", "Grep"],
      },
    },
  },
})) {
  if (message.type === "assistant" && message.message?.content) {
    for (const block of message.message.content) {
      if ("text" in block) {
        console.log(block.text)
      } else if ("name" in block) {
        console.log(`\n[tool] ${block.name}`)
      }
    }
  } else if (message.type === "result") {
    console.log(`\n[done] ${message.subtype}`)
  }
}
