import { mkdirSync, appendFileSync, writeFileSync } from "fs"
import { join } from "path"
import type { TaskResult, AggregateMetrics } from "./evaluator"

export interface RunMetadata {
  runId: string
  startedAt: string
  config: string
  split: string
  model: string
  cacheDir: string
  textOnlyMode: boolean
  gitSha: string | null
  packageVersions: Record<string, string>
}

export class ArtifactWriter {
  private dir: string
  private predictionsPath: string

  constructor(baseDir: string, runId: string) {
    this.dir = join(baseDir, runId)
    mkdirSync(this.dir, { recursive: true })
    this.predictionsPath = join(this.dir, "predictions.jsonl")
  }

  writeTaskResult(result: TaskResult): void {
    const line = JSON.stringify(result) + "\n"
    appendFileSync(this.predictionsPath, line, "utf-8")
  }

  writeSummary(metrics: AggregateMetrics, metadata: RunMetadata): void {
    const summary = {
      metadata,
      metrics,
      completedAt: new Date().toISOString(),
    }
    writeFileSync(
      join(this.dir, "summary.json"),
      JSON.stringify(summary, null, 2) + "\n",
      "utf-8",
    )
  }

  get outputDir(): string {
    return this.dir
  }
}

export function generateRunId(): string {
  const now = new Date()
  const pad = (n: number, len = 2) => String(n).padStart(len, "0")
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

export function tryGetGitSha(): string | null {
  try {
    const { execSync } = require("child_process") as typeof import("child_process")
    return execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim()
  } catch {
    return null
  }
}
