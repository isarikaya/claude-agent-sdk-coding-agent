import 'dotenv/config'

import { query } from "@anthropic-ai/claude-agent-sdk"
import { ORCHESTRATOR_SYSTEM_PROMPT, RESEARCHER_PROMPT, CODE_WRITER_PROMPT } from "./ai/prompts"
import { sandboxMcpServer } from "./mcp/sandbox"

for await (const message of query({
  prompt: "https://refactoring.guru/design-patterns/factory-method look up the factory method example in the documentation and create a minimal example in the factory.ts file. To verify that the code is working in the factory.ts file, type console.log and tell me the output.",
  options: {
    model: "claude-haiku-4-5",
    systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
    permissionMode: "acceptEdits",
    allowedTools: ["Read", "Glob", "Grep", "Agent", "mcp__sandbox-tools__run_in_sandbox"],
    mcpServers: { "sandbox-tools": sandboxMcpServer },
    agents: {
      researcher: {
        description:
          "A specialist research agent. Give it a clear research question and it " +
          "will search the web, fetch relevant pages, and return a structured " +
          "summary with sources.",
        prompt: RESEARCHER_PROMPT,
        tools: ["WebSearch", "WebFetch", "Grep", "Glob", "Read"],
      },
      code_writer: {
        description:
          "A specialist coding agent. Give it a task description and optionally " +
          "existing file paths to modify. It will read relevant files, write or " +
          "edit code, and report what it changed.",
        prompt: CODE_WRITER_PROMPT,
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
