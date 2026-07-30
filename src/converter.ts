import { spawn } from "bun";
import { existsSync, unlinkSync, readdirSync, statSync, mkdirSync } from "fs";
import { join } from "path";
import { downloadSourceVideo } from "./ytdlp";

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
  const job: ConversionJob = {
    id,
    videoId,
    title,
    format,
    status: "pending",
    createdAt: Date.now(),
  };
  jobsMap.set(id, job);

  // Process asynchronously
  processJob(job).catch((err) => {
    job.status = "error";
    job.error = err.message || "Unknown conversion error";
  });

  return job;
}

export function getJob(id: string): ConversionJob | undefined {
  return jobsMap.get(id);
}

async function processJob(job: ConversionJob) {
  const tempFile = join(TEMP_DIR, `${job.id}_src.mp4`);
  const ext = job.format === "mp3" ? "mp3" : "3gp";
  const safeTitle = sanitizeFilename(job.title);
  const outputFilename = `${safeTitle}.${ext}`;
  const outputFile = join(DOWNLOADS_DIR, outputFilename);

  try {
    job.status = "downloading";
    const downloadOk = await downloadSourceVideo(job.videoId, tempFile);
    if (!downloadOk) {
      throw new Error("Failed to download video stream from YouTube.");
    }

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

    const proc = spawn(ffmpegArgs, { stdout: "pipe", stderr: "pipe" });
    const exitCode = await proc.exited;

    if (exitCode !== 0 || !existsSync(outputFile)) {
      const errText = await new Response(proc.stderr).text();
      throw new Error(`FFmpeg error (code ${exitCode}): ${errText.slice(-200)}`);
    }

    const stats = statSync(outputFile);
    job.status = "completed";
    job.filename = outputFilename;
    job.fileSize = formatFileSize(stats.size);

  } catch (err: any) {
    job.status = "error";
    job.error = err.message || "Conversion failed";
  } finally {
    // Clean up temporary downloaded video source
    if (existsSync(tempFile)) {
      try { unlinkSync(tempFile); } catch {}
    }
  }
}

// Background cleanup worker: runs every 10 minutes to delete output files older than 30 minutes
setInterval(() => {
  const now = Date.now();
  const maxAge = 30 * 60 * 1000; // 30 mins

  try {
    const files = readdirSync(DOWNLOADS_DIR);
    for (const f of files) {
      if (f === "temp") continue;
      const path = join(DOWNLOADS_DIR, f);
      const stat = statSync(path);
      if (now - stat.mtimeMs > maxAge) {
        unlinkSync(path);
      }
    }

    // Clean up old jobs from memory
    for (const [id, job] of jobsMap.entries()) {
      if (now - job.createdAt > maxAge) {
        jobsMap.delete(id);
      }
    }
  } catch {
    // Ignore cleanup errors
  }
}, 10 * 60 * 1000);
