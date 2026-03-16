# GAIA Benchmark Runner (Claude Agent SDK)

This project is a TypeScript-based evaluation pipeline for running tasks from the GAIA benchmark dataset, scoring model outputs, and generating run artifacts.

## What It Does

- Fetches `gaia-benchmark/GAIA` from Hugging Face and caches it locally.
- Builds task prompts and decides whether to process or skip based on attachment type.
- Runs Claude via the Agent SDK using the `FINAL ANSWER:` contract.
- Computes per-task scores and aggregate metrics.
- Writes output artifacts under `runs/<run_id>/` for each execution.

## Project Structure

```text
.
├─ agent.ts                    # Main runner (end-to-end flow)
├─ ai/prompts.ts               # System and sub-agent prompts
├─ mcp/sandbox.ts              # E2B sandbox MCP tool
├─ gaia/
│  ├─ dataset.ts               # HF dataset fetch, cache, attachment download
│  ├─ task-packager.ts         # Task -> prompt packaging and skip logic
│  ├─ answer-parser.ts         # FINAL ANSWER extraction and normalization
│  ├─ evaluator.ts             # Task scoring + aggregate metrics
│  ├─ artifacts.ts             # predictions.jsonl / summary.json writer
│  └─ test-validate.ts         # Structural validation tests
└─ gaia/data/                  # Cached dataset and attachment files
```

## Technical Flow

1. `agent.ts` reads `.env` config and loads the dataset with `fetchGaiaDataset(...)`.
2. If needed, attachments are downloaded and verified with `preflightCheck(...)`.
3. Each row is converted to a prompt with `packageTask(...)`:
   - Text files are inlined into the prompt (up to 50k chars).
   - Documents such as `pdf/xlsx/docx/pptx` are referenced with file path context.
   - Unsupported modalities (audio/image/archive, etc.) are skipped.
4. The model is executed through `query(...)` with configured tools and sub-agents.
5. `extractFinalAnswer(...)` parses the final answer from model output.
6. `scoreTask(...)` and `computeAggregateMetrics(...)` calculate scoring metrics.
7. `ArtifactWriter` writes:
   - `predictions.jsonl` (task-level outputs)
   - `summary.json` (metadata + aggregate metrics)

## Requirements

- Node.js 18+
- Hugging Face access (gated GAIA dataset)
- Anthropic API key
- E2B API key (for sandbox execution tool)

## Environment Variables

Copy `.env.example` to `.env` and fill in values:

```env
ANTHROPIC_API_KEY=
E2B_API_KEY=
HF_TOKEN=
GAIA_CACHE_DIR=gaia/data
GAIA_CONFIG=2023_level1
GAIA_SPLIT=validation
GAIA_MODEL=claude-sonnet-4-5
GAIA_LIMIT=
GAIA_OFFSET=0
GAIA_TEXT_ONLY=false
GAIA_MAX_TURNS=30
GAIA_RUNS_DIR=runs
GAIA_FORCE_REFRESH=false
GAIA_SKIP_ATTACHMENTS=false
```

## Running

There are no predefined npm scripts; run directly with `tsx`:

```bash
npx tsx agent.ts
```

Structural validation test:

```bash
npx tsx gaia/test-validate.ts
```

## Outputs

For each run, under `runs/<YYYYMMDD_HHMMSS>/`:

- `predictions.jsonl`: prediction, normalized values, correctness, latency, and skip info per task.
- `summary.json`: run metadata and aggregate metrics (`accuracy`, `accuracy_attempted`, `skip_reasons`, `error_types`).