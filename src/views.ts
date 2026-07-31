import { ConversionJob, DownloadedFileItem, NextCleanupInfo, PaginatedDownloads, estimateSize, getFormatLabel, getQueuePosition } from "./converter";
import { YouTubeSearchResult, PaginatedSearchResults } from "./ytdlp";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderLayout(title: string, bodyContent: string, metaExtra = ""): string {
  return `<!DOCTYPE html PUBLIC "-//WAPFORUM//DTD XHTML Mobile 1.0//EN" "http://www.wapforum.org/DTD/xhtml-mobile10.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="/favicon.ico" type="image/x-icon" />
  ${metaExtra}
  <title>${escapeHtml(title)} - WAP Tube</title>
</head>
<body>
  <div align="center">
    <strong><a href="/" accesskey="1">[1] WAP TUBE</a></strong> | <strong><a href="/downloads" accesskey="2">[2] MY DOWNLOADS</a></strong>
  </div>
  <hr />
  ${bodyContent}
  <hr />
  <div align="center">
    <small>WAP-Net &bull; Feature Phone Downloader</small>
  </div>
</body>
</html>`;
}

export function renderHome(showThumbnails = false): string {
  const content = `
  <fieldset>
    <legend><strong>YouTube Search</strong></legend>
    <form action="/search" method="get">
      <p>
        <label for="q"><strong>Search Query:</strong></label><br />
        <input type="text" id="q" name="q" size="20" accesskey="3" /><br />
        <small>(Accesskey 3: Focus Search Box)</small><br /><br />
        <label><input type="checkbox" name="thumbs" value="1" ${showThumbnails ? 'checked="checked"' : ""} /> Show thumbnails</label><br /><br />
        <input type="submit" value="[ Search YouTube ]" />
      </p>
    </form>
  </fieldset>

  <p align="center">
    <a href="/downloads" accesskey="2"><strong>[2] View Available Downloads</strong></a>
  </p>

  <fieldset>
    <legend><strong>Supported Formats</strong></legend>
    <ul>
      <li><strong>Audio:</strong> MP3 Low (128k), MP3 High (320k)</li>
      <li><strong>Video:</strong> 3GP Low (176x144 QCIF), 3GP High (320x240 QVGA)</li>
    </ul>
  </fieldset>`;

  return renderLayout("Home", content);
}

function renderPaginationBar(baseUrl: string, page: number, totalPages: number | null, hasNextPage: boolean): string {
  const prevLink = page > 1 
    ? `<a href="${baseUrl}&amp;page=${page - 1}" accesskey="7"><strong>[7] &lt;&lt; Prev</strong></a>` 
    : `<span style="color:#777;">[7] &lt;&lt; Prev</span>`;

  const hasNext = totalPages !== null ? page < totalPages : hasNextPage;
  const nextLink = hasNext
    ? `<a href="${baseUrl}&amp;page=${page + 1}" accesskey="9"><strong>[9] Next &gt;&gt;</strong></a>` 
    : `<span style="color:#777;">Next &gt;&gt; [9]</span>`;

  const pageStr = totalPages ? `Page ${page} of ${totalPages}` : `Page ${page}`;

  return `
  <div align="center">
    ${prevLink} | <strong>${pageStr}</strong> | ${nextLink}
  </div>`;
}

export function renderDownloadsList(
  paginatedDownloads: PaginatedDownloads,
  cleanupInfo: NextCleanupInfo,
  activeJobs: ConversionJob[] = []
): string {
  const { items: files, currentPage: page, totalPages, totalItems } = paginatedDownloads;
  let listHtml = "";
  let activeJobsHtml = "";
  let metaRefresh = "";

  if (activeJobs.length > 0) {
    metaRefresh = `<meta http-equiv="refresh" content="10;url=/downloads?page=${page}" />`;
    const jobsContent = activeJobs.map((job, idx) => {
      let statusStr = "";
      if (job.status === "queued") {
        const pos = getQueuePosition(job.id);
        statusStr = pos !== undefined ? `Queued (#${pos} in line)` : "Queued";
      } else if (job.status === "downloading") {
        const p = job.downloadProgress?.percent || 0;
        statusStr = `Downloading (${p}%)`;
      } else if (job.status === "converting") {
        const p = job.conversionProgress?.percent || 0;
        statusStr = `Converting (${p}%)`;
      } else {
        statusStr = "Processing...";
      }

      const formatName = getFormatLabel(job.format);
      return `
      <p style="margin-bottom: 8px;">
        <strong>Job #${idx + 1}: ${escapeHtml(job.title)}</strong><br />
        &bull; Format: <strong>${escapeHtml(formatName)}</strong><br />
        &bull; Status: <strong>${escapeHtml(statusStr)}</strong><br />
        <a href="/status?jobId=${job.id}"><strong>[ Track Progress ]</strong></a>
      </p>`;
    }).join("<hr style='border: 0; border-top: 1px dashed #ccc;' />");

    activeJobsHtml = `
    <fieldset>
      <legend><strong>Active &amp; Queued Jobs (${activeJobs.length})</strong></legend>
      ${jobsContent}
      <p align="right"><small>(Refreshes automatically every 10s)</small></p>
    </fieldset><br />`;
  }

  if (files.length === 0) {
    listHtml = `
    <p align="center">
      <em>No converted files available on this page.</em><br /><br />
      <a href="/" accesskey="1"><strong>[1] Search &amp; Convert Videos</strong></a>
    </p>`;
  } else {
    listHtml = files.map((file, idx) => {
      const itemNum = (page - 1) * paginatedDownloads.pageSize + idx + 1;
      return `
    <fieldset>
      <legend><strong>File #${itemNum}</strong></legend>
      <p>
        <strong>${escapeHtml(file.filename)}</strong><br />
        &bull; Format: <strong>${escapeHtml(file.formatLabel)}</strong><br />
        &bull; Size: <strong>${file.size}</strong><br />
        &bull; Expires in: <strong>${file.expiresInFormatted}</strong><br /><br />
        <a href="/downloads/${encodeURIComponent(file.filename)}"><strong>[ DOWNLOAD FILE ]</strong></a>
      </p>
    </fieldset>`;
    }).join("");
  }

  const paginationBar = renderPaginationBar("/downloads?", page, totalPages, page < totalPages);

  const content = `
  <fieldset>
    <legend><strong>Cleanup Status</strong></legend>
    <p>
      Total Files: <strong>${totalItems}</strong> | Next sweep: <strong>${cleanupInfo.nextCleanupFormatted}</strong><br />
      <small>(Files expire ${cleanupInfo.maxAgeHours} hours after conversion)</small>
    </p>
  </fieldset>

  <p align="right">
    <a href="/downloads?page=${page}">[ Refresh ]</a> | <a href="/" accesskey="1">[1] Search Home</a>
  </p>

  ${activeJobsHtml}
  ${totalItems > paginatedDownloads.pageSize ? paginationBar + "<br />" : ""}
  ${listHtml}
  ${totalItems > paginatedDownloads.pageSize ? "<br />" + paginationBar : ""}

  <p align="center">
    <a href="/" accesskey="1"><strong>[1] Back to Search Home</strong></a>
  </p>`;

  return renderLayout("Available Downloads", content, metaRefresh);
}

export function renderSearchResults(query: string, searchData: PaginatedSearchResults, showThumbnails = false): string {
  const { results, page, hasNextPage } = searchData;
  let listHtml = "";

  if (results.length === 0) {
    listHtml = `<p>No videos found for "<strong>${escapeHtml(query)}</strong>". Please try another search.</p>`;
  } else {
    listHtml = results.map((item, idx) => {
      const itemNum = (page - 1) * searchData.pageSize + idx + 1;
      const thumbHtml = showThumbnails && item.thumbnailUrl
        ? `<p align="center"><img src="${escapeHtml(item.thumbnailUrl)}" alt="${escapeHtml(item.title)}" width="120" style="max-width:100%; height:auto;" /></p>`
        : "";
      return `
    <fieldset>
      <legend><strong>Result #${itemNum}</strong></legend>
      ${thumbHtml}
      <p>
        <strong>${escapeHtml(item.title)}</strong><br />
        <small>Channel: ${escapeHtml(item.channel)} | Duration: ${escapeHtml(item.duration)}</small><br /><br />
        <strong>Download Options:</strong><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=mp3_low&duration=${item.durationSeconds}"><strong>[ MP3 Low 128k (${estimateSize(item.durationSeconds, "mp3_low")}) ]</strong></a><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=mp3_high&duration=${item.durationSeconds}"><strong>[ MP3 High 320k (${estimateSize(item.durationSeconds, "mp3_high")}) ]</strong></a><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_low&duration=${item.durationSeconds}"><strong>[ 3GP Low 176x144 (${estimateSize(item.durationSeconds, "3gp_low")}) ]</strong></a><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_high&duration=${item.durationSeconds}"><strong>[ 3GP High 320x240 (${estimateSize(item.durationSeconds, "3gp_high")}) ]</strong></a>
      </p>
    </fieldset>`;
    }).join("");
  }

  const thumbsParamVal = showThumbnails ? "1" : "0";
  const toggleUrl = `/search?q=${encodeURIComponent(query)}&amp;page=${page}&amp;thumbs=${showThumbnails ? "0" : "1"}`;
  const toggleText = showThumbnails ? "[ Hide Thumbnails ]" : "[ Show Thumbnails ]";

  const baseUrl = `/search?q=${encodeURIComponent(query)}&amp;thumbs=${thumbsParamVal}`;
  const paginationBar = renderPaginationBar(baseUrl, page, null, hasNextPage);

  const content = `
  <fieldset>
    <legend><strong>Search Results</strong></legend>
    <p>
      Query: <strong>"${escapeHtml(query)}"</strong> | <a href="/" accesskey="1">[1] New Search</a><br />
      Thumbnails: <a href="${toggleUrl}"><strong>${toggleText}</strong></a>
    </p>
  </fieldset>

  ${results.length > 0 ? paginationBar + "<br />" : ""}
  ${listHtml}
  ${results.length > 0 ? "<br />" + paginationBar : ""}

  <p align="center">
    <a href="/" accesskey="1"><strong>[1] Search Again</strong></a>
  </p>`;

  return renderLayout(`Results for ${query} (Page ${page})`, content);
}

export function renderProgressBar(percent: number): string {
  const clamped = Math.min(100, Math.max(0, Math.round(percent)));
  const totalBlocks = 10;
  const filledBlocks = Math.round((clamped / 100) * totalBlocks);
  const emptyBlocks = totalBlocks - filledBlocks;
  const bar = "█".repeat(filledBlocks) + "░".repeat(emptyBlocks);
  return `[${bar}] ${clamped}%`;
}

export function renderStatus(job: ConversionJob): string {
  let metaRefresh = "";
  let statusBox = "";

  if (job.status === "queued" || job.status === "pending" || job.status === "downloading" || job.status === "converting") {
    metaRefresh = `<meta http-equiv="refresh" content="5;url=/status?jobId=${job.id}" />`;
    let statusText = "Initializing job...";
    let progressHtml = "";

    if (job.status === "queued") {
      const pos = getQueuePosition(job.id);
      statusText = pos !== undefined ? `Queued (Position #${pos} in line)` : "Queued in processing queue";
      progressHtml = `<p align="center"><small>Your download will start automatically as soon as an active processing slot frees up.</small></p>`;
    } else if (job.status === "downloading") {
      statusText = "Downloading YouTube video source...";
      const p = job.downloadProgress || { percent: 0 };
      const bar = renderProgressBar(p.percent);
      const metrics: string[] = [];
      if (p.speed) metrics.push(`Speed: ${escapeHtml(p.speed)}`);
      if (p.eta) metrics.push(`ETA: ${escapeHtml(p.eta)}`);
      const metricsStr = metrics.length > 0 ? `<br /><small>${metrics.join(" | ")}</small>` : "";

      progressHtml = `
      <code style="font-family:monospace; font-size:1.1em; font-weight:bold;">${bar}</code>
      ${metricsStr}`;
    } else if (job.status === "converting") {
      statusText = "Converting video format...";
      const p = job.conversionProgress || { percent: 0 };
      const bar = renderProgressBar(p.percent);
      const metrics: string[] = [];
      if (p.speed) metrics.push(`Speed: ${escapeHtml(p.speed)}`);
      if (p.detail) metrics.push(`Progress: ${escapeHtml(p.detail)}`);
      const metricsStr = metrics.length > 0 ? `<br /><small>${metrics.join(" | ")}</small>` : "";

      progressHtml = `
      <code style="font-family:monospace; font-size:1.1em; font-weight:bold;">${bar}</code>
      ${metricsStr}`;
    }

    statusBox = `
    <fieldset>
      <legend><strong>Progress Status</strong></legend>
      <p align="center">
        <strong>STATUS: ${statusText}</strong><br /><br />
        ${progressHtml}<br /><br />
        <small>Please wait... Page refreshes automatically every 5 seconds.</small><br /><br />
        <a href="/status?jobId=${job.id}"><strong>[ Manual Refresh ]</strong></a>
      </p>
    </fieldset>`;
  } else if (job.status === "completed") {
    const formatName = getFormatLabel(job.format);
    statusBox = `
    <fieldset>
      <legend><strong>Conversion Complete!</strong></legend>
      <p align="center">
        <strong>Format:</strong> ${escapeHtml(formatName)}<br />
        <strong>File Size:</strong> ${job.fileSize || "Unknown"}<br /><br />
        <a href="/downloads/${encodeURIComponent(job.filename || "")}"><strong>[ CLICK HERE TO DOWNLOAD FILE ]</strong></a>
      </p>
    </fieldset>
    <p align="center">
      <a href="/" accesskey="1">[1] Download Another Video</a> | <a href="/downloads" accesskey="2">[2] View Downloads</a>
    </p>`;
  } else {
    statusBox = `
    <fieldset>
      <legend><strong>Conversion Error</strong></legend>
      <p>
        <strong>Error Details:</strong><br />
        <small>${escapeHtml(job.error || "An error occurred while processing the video.")}</small><br /><br />
        <a href="/" accesskey="1"><strong>[1] Try Again</strong></a>
      </p>
    </fieldset>`;
  }

  const content = `
  <fieldset>
    <legend><strong>Video Title</strong></legend>
    <p><strong>${escapeHtml(job.title)}</strong></p>
  </fieldset>
  ${statusBox}`;

  return renderLayout(`Processing - ${job.title}`, content, metaRefresh);
}

export function renderError(message: string): string {
  const content = `
  <fieldset>
    <legend><strong>Error Notice</strong></legend>
    <p><strong>Message:</strong> ${escapeHtml(message)}</p>
    <p align="center"><a href="/" accesskey="1"><strong>[1] Return to Home</strong></a></p>
  </fieldset>`;

  return renderLayout("Error", content);
}

