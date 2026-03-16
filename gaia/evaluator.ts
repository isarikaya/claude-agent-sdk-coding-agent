import { normalizeAnswer } from "./answer-parser"

export interface TaskResult {
  task_id: string
  level: string
  predicted: string | null
  gold: string
  normalized_pred: string | null
  normalized_gold: string
  correct: boolean
  error_type: string | null
  latency_ms: number
  skipped: boolean
  skip_reason: string | null
}

export interface AggregateMetrics {
  total: number
  attempted: number
  skipped: number
  correct: number
  incorrect: number
  no_answer: number
  accuracy: number
  accuracy_attempted: number
  skip_reasons: Record<string, number>
  error_types: Record<string, number>
}

/**
 * Score a single task: quasi-exact match after normalization.
 */
export function scoreTask(
  taskId: string,
  level: string,
  predicted: string | null,
  gold: string,
  latencyMs: number,
  skipped: boolean,
  skipReason: string | null,
): TaskResult {
  const normalizedGold = normalizeAnswer(gold)

  if (skipped) {
    return {
      task_id: taskId,
      level,
      predicted: null,
      gold,
      normalized_pred: null,
      normalized_gold: normalizedGold,
      correct: false,
      error_type: null,
      latency_ms: latencyMs,
      skipped: true,
      skip_reason: skipReason,
    }
  }

  if (predicted === null) {
    return {
      task_id: taskId,
      level,
      predicted: null,
      gold,
      normalized_pred: null,
      normalized_gold: normalizedGold,
      correct: false,
      error_type: "no_final_answer",
      latency_ms: latencyMs,
      skipped: false,
      skip_reason: null,
    }
  }

  const normalizedPred = normalizeAnswer(predicted)
  const correct = normalizedPred === normalizedGold

  return {
    task_id: taskId,
    level,
    predicted,
    gold,
    normalized_pred: normalizedPred,
    normalized_gold: normalizedGold,
    correct,
    error_type: correct ? null : "wrong_answer",
    latency_ms: latencyMs,
    skipped: false,
    skip_reason: null,
  }
}

/**
 * Compute aggregate metrics from a list of task results.
 */
export function computeAggregateMetrics(results: TaskResult[]): AggregateMetrics {
  const total = results.length
  const skippedResults = results.filter((r) => r.skipped)
  const attempted = results.filter((r) => !r.skipped)
  const correct = attempted.filter((r) => r.correct).length
  const noAnswer = attempted.filter((r) => r.error_type === "no_final_answer").length
  const incorrect = attempted.length - correct

  const skipReasons: Record<string, number> = {}
  for (const r of skippedResults) {
    const reason = r.skip_reason ?? "unknown"
    skipReasons[reason] = (skipReasons[reason] ?? 0) + 1
  }

  const errorTypes: Record<string, number> = {}
  for (const r of attempted) {
    if (r.error_type) {
      errorTypes[r.error_type] = (errorTypes[r.error_type] ?? 0) + 1
    }
  }

  return {
    total,
    attempted: attempted.length,
    skipped: skippedResults.length,
    correct,
    incorrect,
    no_answer: noAnswer,
    accuracy: total > 0 ? correct / total : 0,
    accuracy_attempted: attempted.length > 0 ? correct / attempted.length : 0,
    skip_reasons: skipReasons,
    error_types: errorTypes,
  }
}
