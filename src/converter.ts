import { spawn } from "bun";
import { existsSync, unlinkSync, readdirSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { downloadSourceVideo } from "./ytdlp";
import { logger } from "./logger";

export type FormatType = "mp3" | "mp3_low" | "mp3_high" | "3gp_qcif" | "3gp_qvga" | "3gp_low" | "3gp_high";

export interface JobProgress {
  percent: number;
  speed?: string;
  eta?: string;
  detail?: string;
}

export interface ConversionJob {
  id: string;
  videoId: string;
  title: string;
  durationSeconds?: number;
  format: FormatType;
  status: "queued" | "pending" | "downloading" | "converting" | "completed" | "error";
  clientIp: string;
  downloadProgress?: JobProgress;
  conversionProgress?: JobProgress;
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
const jobQueue: ConversionJob[] = [];
let activeJobsCount = 0;

export let MAX_CONCURRENT_JOBS = parseInt(process.env.MAX_CONCURRENT_JOBS || "5", 10);
export let MAX_JOBS_PER_IP = parseInt(process.env.MAX_JOBS_PER_IP || "3", 10);

export function setQueueConfig(config: { maxConcurrent?: number; maxPerIp?: number }) {
  if (config.maxConcurrent !== undefined) MAX_CONCURRENT_JOBS = config.maxConcurrent;
  if (config.maxPerIp !== undefined) MAX_JOBS_PER_IP = config.maxPerIp;
}

export function getIpActiveAndQueuedCount(clientIp: string): number {
  let count = 0;
  for (const job of jobsMap.values()) {
    if (
      job.clientIp === clientIp &&
      (job.status === "queued" || job.status === "pending" || job.status === "downloading" || job.status === "converting")
    ) {
      count++;
    }
  }
  return count;
}

export function getQueuePosition(jobId: string): number | undefined {
  const idx = jobQueue.findIndex((j) => j.id === jobId);
  return idx !== -1 ? idx + 1 : undefined;
}

export function getQueueStats() {
  return {
    activeJobsCount,
    queuedJobsCount: jobQueue.length,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
    maxJobsPerIp: MAX_JOBS_PER_IP,
  };
}

export function getActiveAndQueuedJobs(): ConversionJob[] {
  const activeAndQueued: ConversionJob[] = [];
  for (const job of jobsMap.values()) {
    if (
      job.status === "queued" ||
      job.status === "pending" ||
      job.status === "downloading" ||
      job.status === "converting"
    ) {
      activeAndQueued.push(job);
    }
  }
  activeAndQueued.sort((a, b) => b.createdAt - a.createdAt);
  return activeAndQueued;
}

export function sanitizeFilename(title: string): string {
  const clean = title
    .replace(/[/\\?%*:|"<>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 0 ? clean : "video";
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function estimateSize(durationSeconds: number, format: FormatType): string {
  if (!durationSeconds || durationSeconds <= 0) return "Unknown";
  let bytesPerSec = 0;
  if (format === "mp3" || format === "mp3_low") {
    bytesPerSec = (128 * 1000) / 8;
  } else if (format === "mp3_high") {
    bytesPerSec = (320 * 1000) / 8;
  } else if (format === "3gp_qcif" || format === "3gp_low") {
    bytesPerSec = ((128 + 12.2) * 1000) / 8;
  } else if (format === "3gp_qvga" || format === "3gp_high") {
    bytesPerSec = ((256 + 48) * 1000) / 8;
  }
  const totalBytes = Math.round(durationSeconds * bytesPerSec);
  return `~${formatFileSize(totalBytes)}`;
}

export function getFormatLabel(format: FormatType): string {
  switch (format) {
    case "mp3":
    case "mp3_low":
      return "MP3 Low (128k)";
    case "mp3_high":
      return "MP3 High (320k)";
    case "3gp_qcif":
    case "3gp_low":
      return "3GP Low (176x144)";
    case "3gp_qvga":
    case "3gp_high":
      return "3GP High (320x240)";
    default:
      return format;
  }
}

function processQueue() {
  while (activeJobsCount < MAX_CONCURRENT_JOBS && jobQueue.length > 0) {
    const job = jobQueue.shift();
    if (!job) break;

    activeJobsCount++;
    const shortId = `job-${job.id.substring(0, 6)}`;
    logger.info("QUEUE", `Starting queued job | Title: "${job.title}" | Active: ${activeJobsCount}/${MAX_CONCURRENT_JOBS}`, shortId);

    processJob(job, shortId)
      .catch((err) => {
        job.status = "error";
        job.error = err.message || "Unknown conversion error";
        logger.error("JOB", `Unhandled error processing job: ${job.error}`, shortId);
      })
      .finally(() => {
        activeJobsCount = Math.max(0, activeJobsCount - 1);
        processQueue();
      });
  }
}

export function createJob(
  videoId: string,
  title: string,
  format: FormatType,
  durationSeconds?: number,
  clientIp: string = "127.0.0.1"
): ConversionJob {
  const currentIpCount = getIpActiveAndQueuedCount(clientIp);
  if (currentIpCount >= MAX_JOBS_PER_IP) {
    throw new Error(`Maximum limit of ${MAX_JOBS_PER_IP} active or queued downloads per IP reached. Please wait for existing jobs to complete.`);
  }

  const id = crypto.randomUUID();
  const shortId = `job-${id.substring(0, 6)}`;
  const job: ConversionJob = {
    id,
    videoId,
    title,
    durationSeconds,
    format,
    status: "queued",
    clientIp,
    createdAt: Date.now(),
  };
  jobsMap.set(id, job);
  jobQueue.push(job);

  const position = jobQueue.length;
  logger.info("JOB", `Created job | Title: "${title}" | Format: ${format} | IP: ${clientIp} | Status: queued (pos ${position})`, shortId, { videoId });

  processQueue();

  return job;
}

export function getJob(id: string): ConversionJob | undefined {
  return jobsMap.get(id);
}

async function processJob(job: ConversionJob, jobLogId: string) {
  const tempFile = join(TEMP_DIR, `${job.id}_src.mp4`);
  const isMp3 = job.format === "mp3" || job.format === "mp3_low" || job.format === "mp3_high";
  const ext = isMp3 ? "mp3" : "3gp";
  const safeTitle = sanitizeFilename(job.title);
  const outputFilename = `${safeTitle}.${ext}`;
  const outputFile = join(DOWNLOADS_DIR, outputFilename);
  const startTime = Date.now();

  try {
    logger.info("JOB", "Transition status: pending -> downloading", jobLogId);
    job.status = "downloading";
    job.downloadProgress = { percent: 0 };
    const downloadOk = await downloadSourceVideo(
      job.videoId,
      tempFile,
      (p) => {
        job.downloadProgress = {
          percent: p.percent,
          speed: p.speed,
          eta: p.eta,
        };
      },
      jobLogId
    );
    if (!downloadOk) {
      throw new Error("Failed to download video stream from YouTube.");
    }

    logger.info("JOB", "Transition status: downloading -> converting", jobLogId);
    job.status = "converting";
    job.conversionProgress = { percent: 0 };
    let ffmpegArgs: string[] = [];

    if (job.format === "mp3" || job.format === "mp3_low") {
      ffmpegArgs = [
        "ffmpeg", "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", tempFile,
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        "-ar", "44100",
        outputFile
      ];
    } else if (job.format === "mp3_high") {
      ffmpegArgs = [
        "ffmpeg", "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", tempFile,
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "320k",
        "-ar", "44100",
        outputFile
      ];
    } else if (job.format === "3gp_qcif" || job.format === "3gp_low") {
      // 176x144 QCIF, H.263 video, AMR audio (Ideal for Starlight M203 and 2G dumb phones)
      ffmpegArgs = [
        "ffmpeg", "-y",
        "-progress", "pipe:1", "-nostats",
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
    } else if (job.format === "3gp_qvga" || job.format === "3gp_high") {
      // 320x240 QVGA, MPEG4 video, AAC audio
      ffmpegArgs = [
        "ffmpeg", "-y",
        "-progress", "pipe:1", "-nostats",
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

    // Stream FFmpeg progress output
    const readFfmpegProgress = async () => {
      try {
        const decoder = new TextDecoder();
        let buffer = "";
        let outTimeUs = 0;
        let speed = "";
        for await (const chunk of proc.stdout) {
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const parts = line.split("=");
            if (parts.length === 2) {
              const key = parts[0].trim();
              const val = parts[1].trim();
              if (key === "out_time_ms") {
                outTimeUs = parseInt(val, 10) || 0;
              } else if (key === "speed") {
                speed = val;
              } else if (key === "progress") {
                if (job.durationSeconds && job.durationSeconds > 0) {
                  const totalUs = job.durationSeconds * 1000000;
                  const percent = Math.min(99, Math.max(0, Math.floor((outTimeUs / totalUs) * 100)));
                  const outSecs = Math.floor(outTimeUs / 1000000);
                  job.conversionProgress = {
                    percent,
                    speed,
                    detail: `${outSecs}s / ${job.durationSeconds}s`,
                  };
                } else {
                  const outSecs = Math.floor(outTimeUs / 1000000);
                  job.conversionProgress = {
                    percent: 50,
                    speed,
                    detail: `${outSecs}s processed`,
                  };
                }
              }
            }
          }
        }
      } catch {
        // Ignore progress reading errors
      }
    };

    const progressPromise = readFfmpegProgress();
    const exitCode = await proc.exited;
    await progressPromise;

    if (exitCode !== 0 || !existsSync(outputFile)) {
      const errText = await new Response(proc.stderr).text();
      throw new Error(`FFmpeg error (code ${exitCode}): ${errText.slice(-200)}`);
    }

    job.conversionProgress = { percent: 100, speed: "100%" };
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

