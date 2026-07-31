import { spawn } from "bun";
import { existsSync } from "fs";
import { join } from "path";
import { logger } from "./logger";

export interface YouTubeSearchResult {
  id: string;
  title: string;
  duration: string;
  durationSeconds: number;
  channel: string;
}

const BIN_DIR = join(import.meta.dir, "..", "bin");
const LOCAL_YTDLP = join(BIN_DIR, "yt-dlp");

function getYtDlpPath(): string {
  if (existsSync(LOCAL_YTDLP)) {
    return LOCAL_YTDLP;
  }
  return "yt-dlp"; // fallback to system command
}

export function formatDuration(seconds: number | undefined): string {
  if (!seconds || isNaN(seconds)) return "Unknown";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export interface PaginatedSearchResults {
  results: YouTubeSearchResult[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
}

export async function searchYouTube(query: string, page = 1, pageSize = 5, reqId?: string): Promise<PaginatedSearchResults> {
  const startTime = Date.now();
  logger.info("SEARCH", `Executing YouTube search | Query: "${query}" | Page: ${page}`, reqId);
  const ytdlp = getYtDlpPath();
  const fetchLimit = page * pageSize + 1;
  const searchSpec = `ytsearch${fetchLimit}:${query}`;
  
  const proc = spawn([ytdlp, searchSpec, "-j", "--flat-playlist", "--no-warnings"], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const output = await new Response(proc.stdout).text();
  await proc.exited;

  const allResults: YouTubeSearchResult[] = [];
  const lines = output.trim().split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const data = JSON.parse(line);
      if (data && data.id) {
        allResults.push({
          id: data.id,
          title: data.title || "Untitled Video",
          durationSeconds: data.duration || 0,
          duration: formatDuration(data.duration),
          channel: data.uploader || data.channel || "Unknown Channel",
        });
      }
    } catch {
      // Ignore JSON parse errors for non-JSON lines
    }
  }

  const startIndex = (page - 1) * pageSize;
  const pageResults = allResults.slice(startIndex, startIndex + pageSize);
  const hasNextPage = allResults.length > startIndex + pageSize;
  const durationMs = Date.now() - startTime;

  logger.info("SEARCH", `Search finished | Found: ${pageResults.length} items`, reqId, { Duration: `${durationMs}ms` });

  return {
    results: pageResults,
    page,
    pageSize,
    hasNextPage,
  };
}

export async function downloadSourceVideo(videoId: string, targetFile: string, jobId?: string): Promise<boolean> {
  const startTime = Date.now();
  logger.info("JOB", `Starting source video download for videoId "${videoId}"`, jobId);
  const ytdlp = getYtDlpPath();
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  
  // Download combined video+audio stream in compatible format or worst video + best audio to save bandwidth
  const proc = spawn([
    ytdlp,
    "-f", "b/b[ext=mp4]/w", // best combined or worst combined for fast download
    "-o", targetFile,
    "--no-playlist",
    "--no-warnings",
    videoUrl
  ], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;
  const elapsedSecs = ((Date.now() - startTime) / 1000).toFixed(2);
  const success = exitCode === 0 && existsSync(targetFile);

  if (success) {
    logger.info("JOB", `Source video download completed in ${elapsedSecs}s`, jobId);
  } else {
    logger.error("JOB", `Source video download failed after ${elapsedSecs}s (exitCode: ${exitCode})`, jobId);
  }

  return success;
}
