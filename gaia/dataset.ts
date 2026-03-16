import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs"
import { join, resolve } from "path"

export interface GaiaRow {
  task_id: string
  Question: string
  Level: string
  "Final answer": string
  file_name: string | null
  file_path: string | null
  "Annotator Metadata": Record<string, unknown> | null
}

export interface GaiaDataset {
  config: string
  split: string
  cacheDir: string
  count: number
  rows: GaiaRow[]
}

export interface GaiaSplitInfo {
  dataset: string
  config: string
  split: string
}

const HF_ROWS_URL = "https://datasets-server.huggingface.co/rows"
const HF_SPLITS_URL = "https://datasets-server.huggingface.co/splits"
const HF_PARQUET_URL = "https://huggingface.co/api/datasets"
const DATASET_ID = "gaia-benchmark/GAIA"

const REQUIRED_COLUMNS = [
  "task_id",
  "Question",
  "Level",
  "Final answer",
  "file_name",
  "file_path",
  "Annotator Metadata",
] as const

const MAX_PAGE_SIZE = 100

function getHfToken(): string {
  const token = process.env.HF_TOKEN
  if (!token) {
    throw new Error(
      "HF_TOKEN environment variable is required for the gated GAIA dataset.\n" +
        "Get a token at https://huggingface.co/settings/tokens and accept " +
        "the gate at https://huggingface.co/datasets/gaia-benchmark/GAIA",
    )
  }
  return token
}

function hfHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${getHfToken()}` }
}

async function hfGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: hfHeaders() })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(`HF API ${res.status} ${res.statusText}: ${url}\n${body}`)
  }
  return res.json() as Promise<T>
}

export async function listSplits(): Promise<GaiaSplitInfo[]> {
  const data = await hfGet<{ splits: GaiaSplitInfo[] }>(
    `${HF_SPLITS_URL}?dataset=${encodeURIComponent(DATASET_ID)}`,
  )
  return data.splits
}

interface HfRowsResponse {
  features: { feature_idx: number; name: string; type: { _type: string } }[]
  rows: { row_idx: number; row: Record<string, unknown>; truncated_cells: string[] }[]
  num_rows_total: number
  num_rows_per_page: number
  partial: boolean
}

/**
 * Fetch all rows for a config/split from the HF datasets-server API,
 * cache them locally as JSON, and return the dataset.
 *
 * Uses pagination to handle splits larger than 100 rows.
 * Caches to `<cacheDir>/<config>_<split>.json` so subsequent loads are instant.
 */
export async function fetchGaiaDataset(
  config: string,
  split: string,
  cacheDir: string,
  forceRefresh = false,
): Promise<GaiaDataset> {
  const cacheFile = join(resolve(cacheDir), `${config}_${split}.json`)

  if (!forceRefresh && existsSync(cacheFile)) {
    console.log(`Loading cached dataset from ${cacheFile}`)
    const cached = JSON.parse(readFileSync(cacheFile, "utf-8")) as GaiaDataset
    validateSchema(cached)
    return cached
  }

  console.log(`Fetching ${DATASET_ID} config=${config} split=${split} from HF API...`)

  const allRows: GaiaRow[] = []
  let offset = 0
  let total = Infinity

  while (offset < total) {
    const url =
      `${HF_ROWS_URL}?dataset=${encodeURIComponent(DATASET_ID)}` +
      `&config=${encodeURIComponent(config)}` +
      `&split=${encodeURIComponent(split)}` +
      `&offset=${offset}&length=${MAX_PAGE_SIZE}`

    const page = await hfGet<HfRowsResponse>(url)
    total = page.num_rows_total

    for (const entry of page.rows) {
      allRows.push(entry.row as unknown as GaiaRow)
    }

    offset += page.rows.length
    console.log(`  Fetched ${allRows.length}/${total} rows`)

    if (page.rows.length === 0) break
  }

  const dataset: GaiaDataset = {
    config,
    split,
    cacheDir: resolve(cacheDir),
    count: allRows.length,
    rows: allRows,
  }

  validateSchema(dataset)

  mkdirSync(resolve(cacheDir), { recursive: true })
  writeFileSync(cacheFile, JSON.stringify(dataset, null, 2), "utf-8")
  console.log(`Cached ${dataset.count} rows to ${cacheFile}`)

  return dataset
}

/**
 * Download a single attachment file from the HF dataset repo.
 * Files are stored under `<cacheDir>/<file_path>` mirroring the repo layout.
 * Returns the absolute local path.
 */
export async function downloadAttachment(
  filePath: string,
  cacheDir: string,
): Promise<string> {
  const localPath = join(resolve(cacheDir), filePath)

  if (existsSync(localPath)) return localPath

  const url =
    `https://huggingface.co/datasets/${DATASET_ID}/resolve/main/${filePath}`

  const res = await fetch(url, { headers: hfHeaders() })
  if (!res.ok) {
    throw new Error(
      `Failed to download attachment ${filePath}: ${res.status} ${res.statusText}`,
    )
  }

  const buffer = Buffer.from(await res.arrayBuffer())
  const dir = join(localPath, "..")
  mkdirSync(dir, { recursive: true })
  writeFileSync(localPath, buffer)

  return localPath
}

/**
 * Download all attachments for a dataset in parallel (with concurrency limit).
 * Returns a map of task_id -> local absolute path (or null if no attachment).
 */
export async function downloadAllAttachments(
  dataset: GaiaDataset,
  concurrency = 5,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>()
  const queue: { taskId: string; filePath: string }[] = []

  for (const row of dataset.rows) {
    if (row.file_path && row.file_path.trim() !== "") {
      queue.push({ taskId: row.task_id, filePath: row.file_path })
    } else {
      results.set(row.task_id, null)
    }
  }

  if (queue.length === 0) return results

  console.log(`Downloading ${queue.length} attachment(s)...`)
  let completed = 0

  async function worker(items: typeof queue): Promise<void> {
    for (const item of items) {
      try {
        const localPath = await downloadAttachment(item.filePath, dataset.cacheDir)
        results.set(item.taskId, localPath)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        console.warn(`  WARNING: Failed to download ${item.filePath}: ${msg}`)
        results.set(item.taskId, null)
      }
      completed++
      if (completed % 10 === 0 || completed === queue.length) {
        console.log(`  Downloaded ${completed}/${queue.length} attachments`)
      }
    }
  }

  const chunks: (typeof queue)[] = Array.from({ length: concurrency }, () => [])
  queue.forEach((item, i) => chunks[i % concurrency].push(item))
  await Promise.all(chunks.map(worker))

  return results
}

function validateSchema(dataset: GaiaDataset): void {
  if (!dataset.rows || dataset.rows.length === 0) {
    throw new Error("GAIA dataset has no rows")
  }

  const sampleKeys = new Set(Object.keys(dataset.rows[0]))
  const missing = REQUIRED_COLUMNS.filter((col) => !sampleKeys.has(col))
  if (missing.length > 0) {
    throw new Error(
      `Schema drift: missing columns: ${missing.join(", ")}. ` +
        `Found: ${[...sampleKeys].join(", ")}`,
    )
  }
}

/**
 * Resolve the absolute local path for a row's attached file.
 * First checks the cache directory, returns null if no attachment.
 * Throws if the file should exist but doesn't.
 */
export function resolveAttachmentPath(
  cacheDir: string,
  row: GaiaRow,
): string | null {
  const fp = row.file_path
  if (!fp || fp.trim() === "") return null

  const absPath = join(resolve(cacheDir), fp)
  if (!existsSync(absPath)) {
    throw new Error(
      `Attachment missing for task ${row.task_id}: ${absPath}\n` +
        `Run the dataset loader with attachment download enabled.`,
    )
  }

  return absPath
}

/**
 * Preflight: verify all attachments exist in the local cache.
 * Returns list of task_ids with missing files.
 */
export function preflightCheck(dataset: GaiaDataset): string[] {
  const missing: string[] = []
  for (const row of dataset.rows) {
    const fp = row.file_path
    if (fp && fp.trim() !== "") {
      const absPath = join(resolve(dataset.cacheDir), fp)
      if (!existsSync(absPath)) {
        missing.push(row.task_id)
      }
    }
  }
  return missing
}
