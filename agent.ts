import { query } from "@anthropic-ai/claude-agent-sdk"

// Researcher sub-agent: performs deep web research on a given topic.
// The orchestrating agent spawns it via the Agent tool whenever it needs
// information that requires browsing or searching the web.

for await (const message of query({
  prompt:
    "Use the researcher agent to investigate the latest best practices for Python error handling in 2025, then summarise the findings.",
  options: {
    model: "claude-haiku-4-5-20251001",
    thinking: { type: "adaptive" },
    allowedTools: ["Read", "Glob", "Grep", "Agent"],
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
