import { createJob, getJob, FormatType, getAvailableDownloads, getNextCleanupInfo } from "./converter";
import { searchYouTube } from "./ytdlp";
import { renderError, renderHome, renderSearchResults, renderStatus, renderDownloadsList } from "./views";
import { join, resolve, relative, isAbsolute } from "path";
import { existsSync, statSync } from "fs";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DOWNLOADS_DIR = join(import.meta.dir, "..", "downloads");

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // Max allowed by Bun. Data transfer keeps connection alive anyway.
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    try {
      // Home page
      if (path === "/") {
        return new Response(renderHome(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Available downloads listing page
      if (path === "/downloads" || path === "/downloads/") {
        const pageParam = url.searchParams.get("page");
        const page = Math.max(1, parseInt(pageParam || "1") || 1);
        const downloads = getAvailableDownloads(page, 5);
        const cleanupInfo = getNextCleanupInfo();
        return new Response(renderDownloadsList(downloads, cleanupInfo), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Search page
      if (path === "/search") {
        const query = url.searchParams.get("q")?.trim();
        if (!query) {
          return Response.redirect("/", 302);
        }
        const pageParam = url.searchParams.get("page");
        const page = Math.max(1, parseInt(pageParam || "1") || 1);
        const searchData = await searchYouTube(query, page, 5);
        return new Response(renderSearchResults(query, searchData), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Start conversion job
      if (path === "/convert") {
        const videoId = url.searchParams.get("id");
        const title = url.searchParams.get("title") || "YouTube Video";
        const format = (url.searchParams.get("format") || "mp3") as FormatType;

        if (!videoId) {
          return new Response(renderError("Invalid video ID."), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        const job = createJob(videoId, title, format);
        return Response.redirect(`/status?jobId=${job.id}`, 302);
      }

      // Status page (Auto-refresh polling)
      if (path === "/status") {
        const jobId = url.searchParams.get("jobId");
        if (!jobId) {
          return new Response(renderError("Missing job ID."), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        const job = getJob(jobId);
        if (!job) {
          return new Response(renderError("Job not found or expired."), {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        }

        return new Response(renderStatus(job), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // Serve downloaded media files (.3gp / .mp3)
      if (path.startsWith("/downloads/")) {
        const rawFilename = path.replace("/downloads/", "");
        if (!rawFilename) {
          return Response.redirect("/downloads", 302);
        }
        const filename = decodeURIComponent(rawFilename);

        const filePath = resolve(DOWNLOADS_DIR, filename);

        // Prevent directory traversal: verify the path stays within DOWNLOADS_DIR
        const relPath = relative(DOWNLOADS_DIR, filePath);
        if (relPath.startsWith("..") || isAbsolute(relPath) || !relPath) {
          return new Response("Access denied", { status: 403 });
        }

        if (!existsSync(filePath)) {
          return new Response("File not found or expired", { status: 404 });
        }

        const file = Bun.file(filePath);
        const is3gp = filename.endsWith(".3gp");
        const isMp3 = filename.endsWith(".mp3");

        const contentType = is3gp ? "video/3gpp" : isMp3 ? "audio/mpeg" : "application/octet-stream";

        return new Response(file, {
          headers: {
            "Content-Type": contentType,
            "Content-Disposition": `attachment; filename="${filename.replace(/"/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
          },
        });
      }

      return new Response(renderError("Page not found."), {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    } catch (err: any) {
      return new Response(renderError(err.message || "Internal server error"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
  },
});

console.log(`[WAP-Net] Server running at http://localhost:${server.port}`);
