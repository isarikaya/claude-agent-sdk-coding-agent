/**
 * Structural validation tests for the GAIA pipeline.
 * Run with: npx tsx gaia/test-validate.ts
 */

import { extractFinalAnswer, normalizeAnswer } from "./answer-parser"
import { scoreTask, computeAggregateMetrics } from "./evaluator"
import { packageTask } from "./task-packager"
import type { GaiaRow } from "./dataset"

let passed = 0
let failed = 0

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++
    console.log(`  PASS: ${label}`)
  } else {
    failed++
    console.error(`  FAIL: ${label}`)
  }
}

// --- Answer parser tests ---
console.log("\n=== Answer Parser ===")

assert(
  extractFinalAnswer("Some reasoning...\nFINAL ANSWER: 42") === "42",
  "basic numeric extraction",
)

assert(
  extractFinalAnswer("FINAL ANSWER: Saint Petersburg") === "Saint Petersburg",
  "city name extraction",
)

assert(
  extractFinalAnswer("thinking...\nFINAL ANSWER: wrong\nmore...\nFINAL ANSWER: correct") === "correct",
  "last-match wins",
)

assert(
  extractFinalAnswer("No answer marker here") === null,
  "null when no marker",
)

assert(
  extractFinalAnswer("Final answer: case insensitive") === "case insensitive",
  "case insensitive match",
)

assert(
  extractFinalAnswer("FINAL  ANSWER:  extra spaces  ") === "extra spaces",
  "handles extra whitespace",
)

// --- Normalization tests ---
console.log("\n=== Normalization ===")

assert(normalizeAnswer("  42  ") === "42", "strip whitespace")
assert(normalizeAnswer("The Beatles") === "beatles", "strip article + lowercase")
assert(normalizeAnswer("$89,706.00") === "$89706.00", "strip thousands comma")
assert(normalizeAnswer("Saint Petersburg.") === "saint petersburg", "strip trailing punct + lowercase")
assert(normalizeAnswer("  A  cat  ") === "cat", "strip article + collapse spaces")

// --- Scorer tests ---
console.log("\n=== Scorer ===")

const r1 = scoreTask("t1", "1", "42", "42", 1000, false, null)
assert(r1.correct === true, "exact match correct")

const r2 = scoreTask("t2", "1", "The answer", "answer", 500, false, null)
assert(r2.correct === true, "normalized match correct")

const r3 = scoreTask("t3", "1", null, "42", 0, false, null)
assert(r3.correct === false && r3.error_type === "no_final_answer", "null prediction scored")

const r4 = scoreTask("t4", "1", null, "42", 0, true, "text_only_mode")
assert(r4.skipped === true, "skipped task tracked")

// --- Aggregate ---
console.log("\n=== Aggregate Metrics ===")

const metrics = computeAggregateMetrics([r1, r2, r3, r4])
assert(metrics.total === 4, "total count")
assert(metrics.attempted === 3, "attempted count")
assert(metrics.skipped === 1, "skipped count")
assert(metrics.correct === 2, "correct count")
assert(Math.abs(metrics.accuracy - 0.5) < 0.001, "accuracy = 2/4")
assert(Math.abs(metrics.accuracy_attempted - 2 / 3) < 0.001, "accuracy_attempted = 2/3")

// --- Task packager tests ---
console.log("\n=== Task Packager ===")

const textRow: GaiaRow = {
  task_id: "test-text",
  Question: "What is 2+2?",
  Level: "1",
  "Final answer": "4",
  file_name: null,
  file_path: null,
  "Annotator Metadata": null,
}
const textPacked = packageTask(textRow, "/fake/dir")
assert(textPacked.skipped === false, "text-only question not skipped")
assert(textPacked.prompt === "What is 2+2?", "text-only prompt is question")

const audioRow: GaiaRow = {
  task_id: "test-audio",
  Question: "What is said?",
  Level: "1",
  "Final answer": "hello",
  file_name: "audio.mp3",
  file_path: "2023/validation/audio.mp3",
  "Annotator Metadata": null,
}
const audioPacked = packageTask(audioRow, "/fake/dir")
assert(audioPacked.skipped === true, "audio file skipped (unsupported)")
assert(audioPacked.skipReason?.includes("unsupported_modality") === true, "skip reason is unsupported_modality")

const textOnlyRow: GaiaRow = {
  task_id: "test-filerow",
  Question: "Read this file",
  Level: "1",
  "Final answer": "answer",
  file_name: "data.csv",
  file_path: "2023/validation/data.csv",
  "Annotator Metadata": null,
}
const textOnlyPacked = packageTask(textOnlyRow, "/fake/dir", true)
assert(textOnlyPacked.skipped === true, "file row skipped in text_only_mode")
assert(textOnlyPacked.skipReason === "text_only_mode", "skip reason is text_only_mode")

// --- Summary ---
console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===`)
process.exit(failed > 0 ? 1 : 0)
