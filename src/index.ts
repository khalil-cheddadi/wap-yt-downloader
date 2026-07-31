import { createJob, getJob, FormatType, getAvailableDownloads, getNextCleanupInfo, getActiveAndQueuedJobs } from "./converter";
import { searchYouTube } from "./ytdlp";
import { renderError, renderHome, renderSearchResults, renderStatus, renderDownloadsList } from "./views";
import { join, resolve, relative, isAbsolute } from "path";
import { existsSync, statSync } from "fs";
import { logger, generateReqId } from "./logger";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
const DOWNLOADS_DIR = join(import.meta.dir, "..", "downloads");

const server = Bun.serve({
  port: PORT,
  idleTimeout: 255, // Max allowed by Bun. Data transfer keeps connection alive anyway.
  async fetch(req) {
    const startTime = Date.now();
    const reqId = generateReqId();
    const url = new URL(req.url);
    const path = url.pathname;
    const userAgent = req.headers.get("user-agent");

    logger.httpIn(reqId, req.method, path, userAgent);

    let res: Response;
    try {
      res = await handleRoute(req, url, path, reqId);
    } catch (err: any) {
      logger.error("HTTP", `Unhandled route error: ${err.message || err}`, reqId);
      res = new Response(renderError(err.message || "Internal server error"), {
        status: 500,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const durationMs = Date.now() - startTime;
    logger.httpOut(reqId, req.method, path, res.status, durationMs);
    return res;
  },
});

logger.info("SERVER", `Server running at http://localhost:${server.port}`);

function parseCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [k, v] = cookie.trim().split("=");
    if (k === name) return v ? decodeURIComponent(v) : "";
  }
  return null;
}

async function handleRoute(req: Request, url: URL, path: string, reqId: string): Promise<Response> {
  // Serve favicon
  if (path === "/favicon.ico") {
    const faviconPath = join(import.meta.dir, "favicon.ico");
    if (existsSync(faviconPath)) {
      return new Response(Bun.file(faviconPath), {
        headers: { "Content-Type": "image/x-icon" },
      });
    }
    return new Response(null, { status: 404 });
  }

  // Home page
  if (path === "/") {
    const thumbsParam = url.searchParams.get("thumbs");
    const cookieHeader = req.headers.get("cookie");
    const cookieThumbs = parseCookie(cookieHeader, "wap_thumbs");
    let showThumbnails = false;

    if (thumbsParam !== null) {
      showThumbnails = thumbsParam === "1";
    } else if (cookieThumbs !== null) {
      showThumbnails = cookieThumbs === "1";
    }

    const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
    if (thumbsParam !== null) {
      headers["Set-Cookie"] = `wap_thumbs=${showThumbnails ? "1" : "0"}; Path=/; Max-Age=31536000`;
    }

    return new Response(renderHome(showThumbnails), { headers });
  }

  // Available downloads listing page
  if (path === "/downloads" || path === "/downloads/") {
    const pageParam = url.searchParams.get("page");
    const page = Math.max(1, parseInt(pageParam || "1") || 1);
    const downloads = getAvailableDownloads(page, 5);
    const cleanupInfo = getNextCleanupInfo();
    const activeJobs = getActiveAndQueuedJobs();
    return new Response(renderDownloadsList(downloads, cleanupInfo, activeJobs), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  // Search page
  if (path === "/search") {
    const query = url.searchParams.get("q")?.trim();
    if (!query) {
      return Response.redirect("/", 302);
    }
    const thumbsParam = url.searchParams.get("thumbs");
    const cookieHeader = req.headers.get("cookie");
    const cookieThumbs = parseCookie(cookieHeader, "wap_thumbs");

    let showThumbnails = false;
    if (thumbsParam !== null) {
      showThumbnails = thumbsParam === "1";
    } else if (cookieThumbs !== null) {
      showThumbnails = cookieThumbs === "1";
    }

    const pageParam = url.searchParams.get("page");
    const page = Math.max(1, parseInt(pageParam || "1") || 1);
    const searchData = await searchYouTube(query, page, 5, reqId);

    const headers: Record<string, string> = { "Content-Type": "text/html; charset=utf-8" };
    if (thumbsParam !== null) {
      headers["Set-Cookie"] = `wap_thumbs=${showThumbnails ? "1" : "0"}; Path=/; Max-Age=31536000`;
    }

    return new Response(renderSearchResults(query, searchData, showThumbnails), { headers });
  }

function getClientIp(req: Request, server: any): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const ips = forwarded.split(",");
    if (ips[0] && ips[0].trim()) {
      return ips[0].trim();
    }
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  const ip = server.requestIP(req);
  return ip?.address || "127.0.0.1";
}

  // Start conversion job
  if (path === "/convert") {
    const videoId = url.searchParams.get("id");
    const title = url.searchParams.get("title") || "YouTube Video";
    const format = (url.searchParams.get("format") || "mp3") as FormatType;
    const durationParam = url.searchParams.get("duration");
    const durationSeconds = durationParam ? parseInt(durationParam, 10) : undefined;

    if (!videoId) {
      return new Response(renderError("Invalid video ID."), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    const clientIp = getClientIp(req, server);
    try {
      const job = createJob(videoId, title, format, durationSeconds, clientIp);
      return Response.redirect(`/status?jobId=${job.id}`, 302);
    } catch (err: any) {
      return new Response(renderError(err.message || "Failed to submit download job."), {
        status: 429,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
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
      logger.warn("MEDIA", `Directory traversal attempt blocked: "${filename}"`, reqId);
      return new Response("Access denied", { status: 403 });
    }

    if (!existsSync(filePath)) {
      logger.warn("MEDIA", `Requested file not found or expired: "${filename}"`, reqId);
      return new Response("File not found or expired", { status: 404 });
    }

    const stats = statSync(filePath);
    const file = Bun.file(filePath);
    const is3gp = filename.endsWith(".3gp");
    const isMp3 = filename.endsWith(".mp3");
    const contentType = is3gp ? "video/3gpp" : isMp3 ? "audio/mpeg" : "application/octet-stream";

    const asciiFilename = filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "_");
    const encodedFilename = encodeURIComponent(filename);

    return new Response(file, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
      },
    });
  }

  return new Response(renderError("Page not found."), {
    status: 404,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
