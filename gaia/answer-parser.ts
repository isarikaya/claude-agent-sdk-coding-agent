/**
 * Extract FINAL ANSWER from model output, matching the GAIA benchmark contract.
 * The model is instructed to end with "FINAL ANSWER: [answer]".
 */

const FINAL_ANSWER_RE = /FINAL\s+ANSWER\s*:\s*(.+)/i

/**
 * Extract the final answer string from the full model output.
 * Returns null if no FINAL ANSWER marker is found.
 *
 * When multiple markers appear, the last one wins (the model may
 * refine its answer over the course of reasoning).
 */
export function extractFinalAnswer(output: string): string | null {
  const lines = output.split("\n")
  let lastMatch: string | null = null

  for (const line of lines) {
    const m = FINAL_ANSWER_RE.exec(line)
    if (m) {
      lastMatch = m[1].trim()
    }
  }

  return lastMatch
}

/**
 * Normalize an answer string for quasi-exact match scoring.
 * Follows the GAIA evaluation protocol:
 *  - lowercase
 *  - strip leading/trailing whitespace
 *  - strip leading articles (a, an, the)
 *  - collapse internal whitespace
 *  - strip trailing punctuation
 *  - normalize number formatting (remove commas used as thousands separators)
 */
export function normalizeAnswer(raw: string): string {
  let s = raw.trim().toLowerCase()

  s = s.replace(/^(a|an|the)\s+/i, "")

  s = s.replace(/\s+/g, " ")

  s = s.replace(/[.!?;:]+$/, "")

  s = s.replace(/(\d),(\d{3})/g, "$1$2")

  return s.trim()
}
