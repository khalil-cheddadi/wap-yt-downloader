import { spawn } from "bun";
import { existsSync, unlinkSync, readdirSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { downloadSourceVideo } from "./ytdlp";
import { logger } from "./logger";

export type FormatType = "mp3" | "3gp_qcif" | "3gp_qvga";

export interface ConversionJob {
  id: string;
  videoId: string;
  title: string;
  format: FormatType;
  status: "pending" | "downloading" | "converting" | "completed" | "error";
  error?: string;
  filename?: string;
  fileSize?: string;
  createdAt: number;
}

const DOWNLOADS_DIR = join(import.meta.dir, "..", "downloads");
const TEMP_DIR = join(import.meta.dir, "..", "downloads", "temp");

// Ensure directories exist
if (!existsSync(DOWNLOADS_DIR)) mkdirSync(DOWNLOADS_DIR, { recursive: true });
if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });

const jobsMap = new Map<string, ConversionJob>();

export function sanitizeFilename(title: string): string {
  const clean = title
    .replace(/[/\\?%*:|"<>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 0 ? clean : "video";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function createJob(videoId: string, title: string, format: FormatType): ConversionJob {
  const id = crypto.randomUUID();
  const shortId = `job-${id.substring(0, 6)}`;
  const job: ConversionJob = {
    id,
    videoId,
    title,
    format,
    status: "pending",
    createdAt: Date.now(),
  };
  jobsMap.set(id, job);

  logger.info("JOB", `Created job | Title: "${title}" | Format: ${format}`, shortId, { videoId });

  // Process asynchronously
  processJob(job, shortId).catch((err) => {
    job.status = "error";
    job.error = err.message || "Unknown conversion error";
    logger.error("JOB", `Unhandled error processing job: ${job.error}`, shortId);
  });

  return job;
}

export function getJob(id: string): ConversionJob | undefined {
  return jobsMap.get(id);
}

async function processJob(job: ConversionJob, jobLogId: string) {
  const tempFile = join(TEMP_DIR, `${job.id}_src.mp4`);
  const ext = job.format === "mp3" ? "mp3" : "3gp";
  const safeTitle = sanitizeFilename(job.title);
  const outputFilename = `${safeTitle}.${ext}`;
  const outputFile = join(DOWNLOADS_DIR, outputFilename);
  const startTime = Date.now();

  try {
    logger.info("JOB", "Transition status: pending -> downloading", jobLogId);
    job.status = "downloading";
    const downloadOk = await downloadSourceVideo(job.videoId, tempFile, jobLogId);
    if (!downloadOk) {
      throw new Error("Failed to download video stream from YouTube.");
    }

    logger.info("JOB", "Transition status: downloading -> converting", jobLogId);
    job.status = "converting";
    let ffmpegArgs: string[] = [];

    if (job.format === "mp3") {
      ffmpegArgs = [
        "ffmpeg", "-y",
        "-i", tempFile,
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        "-ar", "44100",
        outputFile
      ];
    } else if (job.format === "3gp_qcif") {
      // 176x144 QCIF, H.263 video, AMR audio (Ideal for Starlight M203 and 2G dumb phones)
      ffmpegArgs = [
        "ffmpeg", "-y",
        "-i", tempFile,
        "-vf", "scale=176:144:force_original_aspect_ratio=decrease,pad=176:144:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "h263",
        "-b:v", "128k",
        "-r", "15",
        "-c:a", "libopencore_amrnb",
        "-ar", "8000",
        "-ac", "1",
        "-b:a", "12.2k",
        outputFile
      ];
    } else if (job.format === "3gp_qvga") {
      // 320x240 QVGA, MPEG4 video, AAC audio
      ffmpegArgs = [
        "ffmpeg", "-y",
        "-i", tempFile,
        "-vf", "scale=320:240:force_original_aspect_ratio=decrease,pad=320:240:(ow-iw)/2:(oh-ih)/2",
        "-c:v", "mpeg4",
        "-b:v", "256k",
        "-r", "20",
        "-c:a", "aac",
        "-ar", "22050",
        "-ac", "1",
        "-b:a", "48k",
        outputFile
      ];
    }

    logger.info("JOB", `Starting FFmpeg conversion (${job.format})`, jobLogId);
    const proc = spawn(ffmpegArgs, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;

    if (exitCode !== 0 || !existsSync(outputFile)) {
      const errText = await new Response(proc.stderr).text();
      throw new Error(`FFmpeg error (code ${exitCode}): ${errText.slice(-200)}`);
    }

    const stats = statSync(outputFile);
    const totalElapsedSecs = ((Date.now() - startTime) / 1000).toFixed(2);
    job.status = "completed";
    job.filename = outputFilename;
    job.fileSize = formatFileSize(stats.size);

    logger.info(
      "JOB",
      `Transition status: converting -> completed | File: "${outputFilename}" | Size: ${job.fileSize} | Duration: ${totalElapsedSecs}s`,
      jobLogId
    );

  } catch (err: any) {
    job.status = "error";
    job.error = err.message || "Conversion failed";
    logger.error("JOB", `Transition status: -> error | Reason: ${job.error}`, jobLogId);
  } finally {
    // Clean up temporary downloaded video source
    if (existsSync(tempFile)) {
      try { unlinkSync(tempFile); } catch {}
    }
  }
}

const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const MAX_FILE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

let nextCleanupTime = Date.now() + CLEANUP_INTERVAL_MS;

export interface NextCleanupInfo {
  nextCleanupInSeconds: number;
  nextCleanupFormatted: string;
  maxAgeHours: number;
}

export interface DownloadedFileItem {
  filename: string;
  size: string;
  sizeBytes: number;
  createdAtMs: number;
  expiresInSeconds: number;
  expiresInFormatted: string;
  formatLabel: string;
}

export function formatDurationSeconds(seconds: number): string {
  if (seconds <= 0) return "imminent";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0 || hours > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

export function runCleanup() {
  const now = Date.now();
  nextCleanupTime = now + CLEANUP_INTERVAL_MS;
  let deletedFiles = 0;
  let checkedFiles = 0;

  try {
    const files = readdirSync(DOWNLOADS_DIR);
    for (const f of files) {
      if (f === "temp" || f.startsWith(".")) continue;
      checkedFiles++;
      const path = join(DOWNLOADS_DIR, f);
      const stat = statSync(path);
      if (now - stat.mtimeMs > MAX_FILE_AGE_MS) {
        unlinkSync(path);
        deletedFiles++;
      }
    }

    // Clean up old jobs from memory
    let deletedJobs = 0;
    for (const [id, job] of jobsMap.entries()) {
      if (now - job.createdAt > MAX_FILE_AGE_MS) {
        jobsMap.delete(id);
        deletedJobs++;
      }
    }

    logger.info("MEDIA", `Background cleanup sweep completed`, undefined, {
      "Checked Files": checkedFiles,
      "Deleted Expired Files": deletedFiles,
      "Cleaned Jobs": deletedJobs,
    });
  } catch (err: any) {
    logger.error("MEDIA", `Error during background cleanup sweep: ${err.message}`);
  }
}

// Background cleanup worker
setInterval(runCleanup, CLEANUP_INTERVAL_MS);

export function getNextCleanupInfo(): NextCleanupInfo {
  const now = Date.now();
  const diffMs = nextCleanupTime - now;
  const nextCleanupInSeconds = Math.max(0, Math.ceil(diffMs / 1000));
  return {
    nextCleanupInSeconds,
    nextCleanupFormatted: formatDurationSeconds(nextCleanupInSeconds),
    maxAgeHours: 24,
  };
}

export interface PaginatedDownloads {
  items: DownloadedFileItem[];
  totalItems: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
}

export function getAvailableDownloads(page = 1, pageSize = 5): PaginatedDownloads {
  const now = Date.now();
  const allFiles: DownloadedFileItem[] = [];

  if (!existsSync(DOWNLOADS_DIR)) {
    return { items: [], totalItems: 0, totalPages: 1, currentPage: 1, pageSize };
  }

  try {
    const files = readdirSync(DOWNLOADS_DIR);
    for (const f of files) {
      if (f === "temp" || f.startsWith(".")) continue;
      const filePath = join(DOWNLOADS_DIR, f);
      const stat = statSync(filePath);
      if (stat.isDirectory()) continue;

      const ageMs = now - stat.mtimeMs;
      const expiresInSeconds = Math.max(0, Math.ceil((MAX_FILE_AGE_MS - ageMs) / 1000));

      let formatLabel = "File";
      if (f.endsWith(".mp3")) {
        formatLabel = "MP3 Audio";
      } else if (f.endsWith(".3gp")) {
        formatLabel = "3GP Video";
      }

      allFiles.push({
        filename: f,
        size: formatFileSize(stat.size),
        sizeBytes: stat.size,
        createdAtMs: stat.mtimeMs,
        expiresInSeconds,
        expiresInFormatted: formatDurationSeconds(expiresInSeconds),
        formatLabel,
      });
    }
  } catch {
    // Ignore read errors
  }

  allFiles.sort((a, b) => b.createdAtMs - a.createdAtMs);

  const totalItems = allFiles.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const validPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (validPage - 1) * pageSize;
  const items = allFiles.slice(startIndex, startIndex + pageSize);

  return {
    items,
    totalItems,
    totalPages,
    currentPage: validPage,
    pageSize,
  };
}

