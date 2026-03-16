import { extname } from "path"
import { readFileSync } from "fs"
import type { GaiaRow } from "./dataset"
import { resolveAttachmentPath } from "./dataset"

export interface PackagedTask {
  taskId: string
  question: string
  level: string
  gold: string
  prompt: string
  attachmentPath: string | null
  attachmentExt: string | null
  skipped: boolean
  skipReason: string | null
}

const SUPPORTED_TEXT_EXTS = new Set([
  ".txt", ".csv", ".json", ".jsonl", ".jsonld",
  ".xml", ".md", ".py", ".js", ".ts", ".html",
  ".css", ".yaml", ".yml", ".toml", ".ini", ".cfg",
  ".log", ".tsv",
])

const SUPPORTED_DOC_EXTS = new Set([".pdf", ".xlsx", ".xls", ".docx", ".pptx"])

const UNSUPPORTED_MEDIA_EXTS = new Set([
  ".mp3", ".mp4", ".m4a", ".wav", ".ogg", ".flac",
  ".mov", ".avi", ".webm", ".mkv",
  ".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".webp", ".svg",
  ".pdb", ".zip", ".tar", ".gz", ".rar",
])

function classifyExtension(ext: string): "text" | "document" | "unsupported" | "unknown" {
  const lower = ext.toLowerCase()
  if (SUPPORTED_TEXT_EXTS.has(lower)) return "text"
  if (SUPPORTED_DOC_EXTS.has(lower)) return "document"
  if (UNSUPPORTED_MEDIA_EXTS.has(lower)) return "unsupported"
  return "unknown"
}

function buildFileContext(attachmentPath: string, ext: string, classification: string): string {
  if (classification === "text") {
    const content = readFileSync(attachmentPath, "utf-8")
    const truncated = content.length > 50_000
      ? content.slice(0, 50_000) + "\n\n[...truncated at 50000 chars...]"
      : content
    return (
      `\n\n---\nATTACHED FILE (${ext}):\n` +
      "```\n" + truncated + "\n```"
    )
  }

  if (classification === "document") {
    return (
      `\n\n---\nATTACHED FILE: ${attachmentPath}\n` +
      `File type: ${ext}\n` +
      `NOTE: This is a ${ext} document. You may need to use the researcher or code_writer ` +
      `agent to read/parse this file with appropriate tools (e.g. Python pandas for xlsx, ` +
      `PyPDF2 for pdf, python-docx for docx, python-pptx for pptx). ` +
      `Upload it to the sandbox if needed.`
    )
  }

  return ""
}

/**
 * Package a GAIA row into a prompt-ready task with attachment context.
 *
 * If textOnlyMode is true, rows with non-empty file_path are skipped
 * for a quick web/text baseline pass.
 */
export function packageTask(
  row: GaiaRow,
  snapshotDir: string,
  textOnlyMode = false,
): PackagedTask {
  const base: Omit<PackagedTask, "prompt" | "skipped" | "skipReason"> = {
    taskId: row.task_id,
    question: row.Question,
    level: row.Level,
    gold: row["Final answer"],
    attachmentPath: null,
    attachmentExt: null,
  }

  const hasFile = row.file_path && row.file_path.trim() !== ""

  if (textOnlyMode && hasFile) {
    return {
      ...base,
      prompt: "",
      skipped: true,
      skipReason: "text_only_mode",
    }
  }

  if (!hasFile) {
    return {
      ...base,
      prompt: row.Question,
      skipped: false,
      skipReason: null,
    }
  }

  // Classify extension early (before path resolution) so unsupported
  // modalities are detected even when the file is missing on disk.
  const ext = extname(row.file_path!).toLowerCase()
  const classification = classifyExtension(ext)

  if (classification === "unsupported") {
    return {
      ...base,
      attachmentExt: ext,
      prompt: "",
      skipped: true,
      skipReason: `skipped_unsupported_modality:${ext}`,
    }
  }

  if (classification === "unknown") {
    return {
      ...base,
      attachmentExt: ext,
      prompt: "",
      skipped: true,
      skipReason: `skipped_unknown_extension:${ext}`,
    }
  }

  let attachmentPath: string | null
  try {
    attachmentPath = resolveAttachmentPath(snapshotDir, row)
  } catch {
    return {
      ...base,
      attachmentExt: ext,
      prompt: "",
      skipped: true,
      skipReason: "attachment_missing",
    }
  }

  if (!attachmentPath) {
    return {
      ...base,
      prompt: row.Question,
      skipped: false,
      skipReason: null,
    }
  }

  const fileContext = buildFileContext(attachmentPath, ext, classification)

  return {
    ...base,
    attachmentPath,
    attachmentExt: ext,
    prompt: row.Question + fileContext,
    skipped: false,
    skipReason: null,
  }
}
