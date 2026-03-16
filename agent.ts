import "dotenv/config"

import { query } from "@anthropic-ai/claude-agent-sdk"
import {
  GAIA_SYSTEM_PROMPT,
  RESEARCHER_PROMPT,
  CODE_WRITER_PROMPT,
} from "./ai/prompts"
import { sandboxMcpServer } from "./mcp/sandbox"
import {
  fetchGaiaDataset,
  downloadAllAttachments,
  preflightCheck,
} from "./gaia/dataset"
import { packageTask } from "./gaia/task-packager"
import { extractFinalAnswer } from "./gaia/answer-parser"
import { scoreTask, computeAggregateMetrics, type TaskResult } from "./gaia/evaluator"
import {
  ArtifactWriter,
  generateRunId,
  tryGetGitSha,
  type RunMetadata,
} from "./gaia/artifacts"
import { readFileSync } from "fs"

// ---------------------------------------------------------------------------
// Configuration via environment variables
// ---------------------------------------------------------------------------
const GAIA_CACHE_DIR = process.env.GAIA_CACHE_DIR ?? "gaia/data"
const GAIA_CONFIG = process.env.GAIA_CONFIG ?? "2023_level1"
const GAIA_SPLIT = process.env.GAIA_SPLIT ?? "validation"
const GAIA_MODEL = process.env.GAIA_MODEL ?? "claude-sonnet-4-5"
const GAIA_LIMIT = process.env.GAIA_LIMIT ? parseInt(process.env.GAIA_LIMIT, 10) : undefined
const GAIA_OFFSET = process.env.GAIA_OFFSET ? parseInt(process.env.GAIA_OFFSET, 10) : 0
const GAIA_TEXT_ONLY = process.env.GAIA_TEXT_ONLY === "true"
const GAIA_MAX_TURNS = process.env.GAIA_MAX_TURNS ? parseInt(process.env.GAIA_MAX_TURNS, 10) : 30
const GAIA_RUNS_DIR = process.env.GAIA_RUNS_DIR ?? "runs"
const GAIA_FORCE_REFRESH = process.env.GAIA_FORCE_REFRESH === "true"
const GAIA_SKIP_ATTACHMENTS = process.env.GAIA_SKIP_ATTACHMENTS === "true"

// ---------------------------------------------------------------------------
// Load dataset from HF API (with local caching) and download attachments
// ---------------------------------------------------------------------------
console.log(`\n=== GAIA Benchmark Runner ===`)
console.log(`Config: ${GAIA_CONFIG} | Split: ${GAIA_SPLIT} | Model: ${GAIA_MODEL}`)
console.log(`Text-only mode: ${GAIA_TEXT_ONLY} | Max turns: ${GAIA_MAX_TURNS}`)

const dataset = await fetchGaiaDataset(GAIA_CONFIG, GAIA_SPLIT, GAIA_CACHE_DIR, GAIA_FORCE_REFRESH)
console.log(`Loaded ${dataset.count} tasks from ${GAIA_CONFIG}/${GAIA_SPLIT}`)

if (!GAIA_SKIP_ATTACHMENTS && !GAIA_TEXT_ONLY) {
  await downloadAllAttachments(dataset)
}

const missingFiles = preflightCheck(dataset)
if (missingFiles.length > 0) {
  console.warn(
    `WARNING: ${missingFiles.length} task(s) have missing attachments: ` +
      missingFiles.slice(0, 5).join(", ") +
      (missingFiles.length > 5 ? "..." : ""),
  )
}

// ---------------------------------------------------------------------------
// Prepare run artifacts
// ---------------------------------------------------------------------------
const runId = generateRunId()
const writer = new ArtifactWriter(GAIA_RUNS_DIR, runId)
console.log(`Run ID: ${runId} | Output: ${writer.outputDir}\n`)

const pkgJson = JSON.parse(readFileSync("package.json", "utf-8"))

const metadata: RunMetadata = {
  runId,
  startedAt: new Date().toISOString(),
  config: GAIA_CONFIG,
  split: GAIA_SPLIT,
  model: GAIA_MODEL,
  cacheDir: dataset.cacheDir,
  textOnlyMode: GAIA_TEXT_ONLY,
  gitSha: tryGetGitSha(),
  packageVersions: pkgJson.dependencies ?? {},
}

// ---------------------------------------------------------------------------
// Task loop
// ---------------------------------------------------------------------------
const results: TaskResult[] = []
let rows = dataset.rows.slice(GAIA_OFFSET)
if (GAIA_LIMIT !== undefined) {
  rows = rows.slice(0, GAIA_LIMIT)
}

console.log(`Running ${rows.length} tasks (offset ${GAIA_OFFSET})...\n`)

for (const [idx, row] of rows.entries()) {
  const taskNum = idx + 1
  const packed = packageTask(row, dataset.cacheDir, GAIA_TEXT_ONLY)
  const tag = `[${taskNum}/${rows.length}] ${packed.taskId}`

  if (packed.skipped) {
    console.log(`${tag} SKIPPED (${packed.skipReason})`)
    const result = scoreTask(
      packed.taskId,
      packed.level,
      null,
      packed.gold,
      0,
      true,
      packed.skipReason,
    )
    results.push(result)
    writer.writeTaskResult(result)
    continue
  }

  console.log(`${tag} running...`)
  const startTime = Date.now()
  let fullOutput = ""

  try {
    for await (const message of query({
      prompt: packed.prompt,
      options: {
        model: GAIA_MODEL,
        systemPrompt: GAIA_SYSTEM_PROMPT,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        maxTurns: GAIA_MAX_TURNS,
        allowedTools: [
          "Read",
          "Glob",
          "Grep",
          "Agent",
          "mcp__sandbox-tools__run_in_sandbox",
        ],
        mcpServers: { "sandbox-tools": sandboxMcpServer },
        agents: {
          researcher: {
            description:
              "A specialist research agent. Give it a clear research question and " +
              "it will search the web, fetch relevant pages, and return a structured " +
              "summary with sources.",
            prompt: RESEARCHER_PROMPT,
            tools: ["WebSearch", "WebFetch", "Grep", "Glob", "Read"],
          },
          code_writer: {
            description:
              "A specialist coding agent. Give it a task and file paths. It will " +
              "read relevant files, write or edit code, and report what it changed.",
            prompt: CODE_WRITER_PROMPT,
            tools: ["Read", "Write", "Edit", "Glob", "Grep"],
          },
        },
      },
    })) {
      if (message.type === "assistant" && message.message?.content) {
        for (const block of message.message.content) {
          if ("text" in block) {
            fullOutput += block.text + "\n"
          }
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error(`${tag} ERROR: ${errMsg}`)
    fullOutput += `\nERROR: ${errMsg}`
  }

  const latencyMs = Date.now() - startTime
  const predicted = extractFinalAnswer(fullOutput)
  const result = scoreTask(
    packed.taskId,
    packed.level,
    predicted,
    packed.gold,
    latencyMs,
    false,
    null,
  )

  const mark = result.correct ? "CORRECT" : "WRONG"
  console.log(
    `${tag} ${mark} (${(latencyMs / 1000).toFixed(1)}s) ` +
      `pred="${predicted ?? "(none)"}" gold="${packed.gold}"`,
  )

  results.push(result)
  writer.writeTaskResult(result)
}

// ---------------------------------------------------------------------------
// Aggregate and report
// ---------------------------------------------------------------------------
const metrics = computeAggregateMetrics(results)
writer.writeSummary(metrics, metadata)

console.log(`\n=== Results ===`)
console.log(`Total: ${metrics.total}`)
console.log(`Attempted: ${metrics.attempted}`)
console.log(`Skipped: ${metrics.skipped}`)
console.log(`Correct: ${metrics.correct}`)
console.log(`Accuracy (all): ${(metrics.accuracy * 100).toFixed(1)}%`)
console.log(`Accuracy (attempted): ${(metrics.accuracy_attempted * 100).toFixed(1)}%`)
if (Object.keys(metrics.skip_reasons).length > 0) {
  console.log(`Skip reasons:`, metrics.skip_reasons)
}
if (Object.keys(metrics.error_types).length > 0) {
  console.log(`Error types:`, metrics.error_types)
}
console.log(`\nArtifacts written to: ${writer.outputDir}`)
