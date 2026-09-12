import { spawn } from "bun";
import { existsSync, unlinkSync, readdirSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { downloadSourceVideo } from "./ytdlp";
import { logger } from "./logger";

export type FormatType = "mp3" | "mp3_low" | "mp3_high" | "3gp_360p" | "3gp_480p" | "3gp_qcif" | "3gp_qvga" | "3gp_low" | "3gp_high";

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
  } else if (format === "3gp_360p") {
    bytesPerSec = ((450 + 64) * 1000) / 8;
  } else if (format === "3gp_480p") {
    bytesPerSec = ((800 + 96) * 1000) / 8;
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
    case "3gp_360p":
      return "3GP 360p";
    case "3gp_480p":
      return "3GP 480p";
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
  const tempFile = join(TEMP_DIR, `video_${job.videoId}_src.mp4`);
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
    const downloadRes = await downloadSourceVideo(
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
    if (!downloadRes.success) {
      throw new Error(downloadRes.error || "Failed to download video stream from YouTube.");
    }

    const sourceVideoFile = downloadRes.actualFile || tempFile;

    logger.info("JOB", "Transition status: downloading -> converting", jobLogId);
    job.status = "converting";
    job.conversionProgress = { percent: 0 };
    const ffmpeg = "ffmpeg";
    let ffmpegArgs: string[] = [];

    if (job.format === "mp3" || job.format === "mp3_low") {
      ffmpegArgs = [
        ffmpeg, "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", sourceVideoFile,
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "128k",
        "-ar", "44100",
        outputFile
      ];
    } else if (job.format === "mp3_high") {
      ffmpegArgs = [
        ffmpeg, "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", sourceVideoFile,
        "-vn",
        "-c:a", "libmp3lame",
        "-b:a", "320k",
        "-ar", "44100",
        outputFile
      ];
    } else if (job.format === "3gp_360p") {
      // 360p, MPEG4 video, AAC audio
      ffmpegArgs = [
        ffmpeg, "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", sourceVideoFile,
        "-vf", "scale=-2:360",
        "-c:v", "mpeg4",
        "-b:v", "450k",
        "-r", "24",
        "-c:a", "aac",
        "-ar", "44100",
        "-b:a", "64k",
        outputFile
      ];
    } else if (job.format === "3gp_480p") {
      // 480p, MPEG4 video, AAC audio
      ffmpegArgs = [
        ffmpeg, "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", sourceVideoFile,
        "-vf", "scale=-2:480",
        "-c:v", "mpeg4",
        "-b:v", "800k",
        "-r", "24",
        "-c:a", "aac",
        "-ar", "44100",
        "-b:a", "96k",
        outputFile
      ];
    } else if (job.format === "3gp_qcif" || job.format === "3gp_low") {
      // 176x144 QCIF, H.263 video, AMR audio (Ideal for Starlight M203 and 2G dumb phones)
      ffmpegArgs = [
        ffmpeg, "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", sourceVideoFile,
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
        ffmpeg, "-y",
        "-progress", "pipe:1", "-nostats",
        "-i", sourceVideoFile,
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
      console.error(`\n================== [${jobLogId}] FFMPEG ERROR DETAILS ==================`);
      console.error(`Exit Code: ${exitCode}`);
      console.error(`Target File: ${outputFile}`);
      console.error(`Output File Exists: ${existsSync(outputFile)}`);
      if (errText.trim()) {
        console.error(`\n--- STDERR ---\n${errText.trim()}`);
      }
      console.error(`=======================================================================\n`);
      throw new Error(`FFmpeg error (code ${exitCode}): ${errText.trim().slice(-300) || "Process failed or file missing"}`);
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
    console.error(`\n================== [${jobLogId}] CONVERSION FAILURE ==================`);
    console.error(`Error: ${job.error}`);
    if (err.stack) {
      console.error(`Stack trace:\n${err.stack}`);
    }
    console.error(`=====================================================================\n`);
  } finally {
    // If the job failed, clean up any unfinished partial files (.part, .ytdl, .tmp)
    if (job.status === "error") {
      try {
        if (existsSync(TEMP_DIR)) {
          const prefix = `video_${job.videoId}_src`;
          const tempFiles = readdirSync(TEMP_DIR);
          for (const file of tempFiles) {
            if (file.startsWith(prefix) && (file.endsWith(".part") || file.endsWith(".ytdl") || file.endsWith(".tmp"))) {
              try { unlinkSync(join(TEMP_DIR, file)); } catch { }
            }
          }
        }
      } catch { }
    }
  }
}

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
export const MAX_FILE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export let MAX_TEMP_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

export function setCleanupConfig(config: { maxTempAgeMs?: number; maxFileAgeMs?: number }) {
  if (config.maxTempAgeMs !== undefined) MAX_TEMP_AGE_MS = config.maxTempAgeMs;
}

export function purgeTempDir(maxAgeMs: number = MAX_TEMP_AGE_MS): { deleted: number; checked: number } {
  let checked = 0;
  let deleted = 0;
  if (!existsSync(TEMP_DIR)) return { deleted, checked };

  const now = Date.now();
  // Get active videoIds being processed so we never delete an active source file
  const activeVideoIds = new Set<string>();
  for (const job of jobsMap.values()) {
    if (job.status === "downloading" || job.status === "converting" || job.status === "queued" || job.status === "pending") {
      activeVideoIds.add(job.videoId);
    }
  }

  try {
    const files = readdirSync(TEMP_DIR);
    for (const f of files) {
      if (f.startsWith(".")) continue;
      checked++;
      const filePath = join(TEMP_DIR, f);
      try {
        const stat = statSync(filePath);
        if (stat.isDirectory()) continue;

        // Clean up partial fragments older than 5 minutes
        const isPartial = f.endsWith(".part") || f.endsWith(".ytdl") || f.endsWith(".tmp");
        const threshold = isPartial ? 5 * 60 * 1000 : maxAgeMs;

        // Check if file is associated with currently active job
        const isActive = Array.from(activeVideoIds).some((vId) => f.includes(vId));
        if (!isActive && now - stat.mtimeMs > threshold) {
          unlinkSync(filePath);
          deleted++;
        }
      } catch { }
    }
  } catch (err: any) {
    logger.error("MEDIA", `Error purging temp directory: ${err.message || err}`);
  }

  return { deleted, checked };
}

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

    // Purge expired and temporary files from TEMP_DIR
    const tempPurge = purgeTempDir(MAX_TEMP_AGE_MS);

    // Clean up old jobs from memory
    let deletedJobs = 0;
    for (const [id, job] of jobsMap.entries()) {
      if (now - job.createdAt > MAX_FILE_AGE_MS) {
        jobsMap.delete(id);
        deletedJobs++;
      }
    }

    logger.info("MEDIA", `Background cleanup sweep completed`, undefined, {
      "Checked Downloads": checkedFiles,
      "Deleted Expired Downloads": deletedFiles,
      "Checked Temp Files": tempPurge.checked,
      "Purged Temp Files": tempPurge.deleted,
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

