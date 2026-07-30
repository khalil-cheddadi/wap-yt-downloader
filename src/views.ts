import { ConversionJob, DownloadedFileItem, NextCleanupInfo } from "./converter";
import { YouTubeSearchResult } from "./ytdlp";

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
  ${metaExtra}
  <title>${escapeHtml(title)} - WAP Tube</title>
</head>
<body>
  <div align="center">
    <strong><a href="/">WAP TUBE</a></strong> | <strong><a href="/downloads">MY DOWNLOADS</a></strong>
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

export function renderHome(): string {
  const content = `
  <fieldset>
    <legend><strong>YouTube Search</strong></legend>
    <form action="/search" method="get">
      <p>
        <label for="q"><strong>Search Query:</strong></label><br />
        <input type="text" id="q" name="q" size="20" /><br /><br />
        <input type="submit" value="[ Search YouTube ]" />
      </p>
    </form>
  </fieldset>

  <p align="center">
    <a href="/downloads"><strong>[ View Available Downloads ]</strong></a>
  </p>

  <fieldset>
    <legend><strong>Supported Formats</strong></legend>
    <ul>
      <li><strong>Audio:</strong> MP3 (128 kbps)</li>
      <li><strong>2G Video:</strong> 3GP (176x144 QCIF)</li>
      <li><strong>Mobile Video:</strong> 3GP (320x240 QVGA)</li>
    </ul>
  </fieldset>`;

  return renderLayout("Home", content);
}

export function renderDownloadsList(files: DownloadedFileItem[], cleanupInfo: NextCleanupInfo): string {
  let listHtml = "";

  if (files.length === 0) {
    listHtml = `
    <p align="center">
      <em>No converted files available for download.</em><br /><br />
      <a href="/"><strong>[ Search &amp; Convert Videos ]</strong></a>
    </p>`;
  } else {
    listHtml = files.map((file, idx) => `
    <fieldset>
      <legend><strong>File #${idx + 1}</strong></legend>
      <p>
        <strong>${escapeHtml(file.filename)}</strong><br />
        &bull; Format: <strong>${escapeHtml(file.formatLabel)}</strong><br />
        &bull; Size: <strong>${file.size}</strong><br />
        &bull; Expires in: <strong>${file.expiresInFormatted}</strong><br /><br />
        <a href="/downloads/${encodeURIComponent(file.filename)}"><strong>[ DOWNLOAD FILE ]</strong></a>
      </p>
    </fieldset>
    `).join("");
  }

  const content = `
  <fieldset>
    <legend><strong>Cleanup Status</strong></legend>
    <p>
      Next auto-cleanup sweep: <strong>${cleanupInfo.nextCleanupFormatted}</strong><br />
      <small>(Files expire ${cleanupInfo.maxAgeHours} hours after conversion)</small>
    </p>
  </fieldset>

  <p align="right">
    <a href="/downloads">[ Refresh List ]</a> | <a href="/">[ New Search ]</a>
  </p>

  ${listHtml}

  <p align="center">
    <a href="/"><strong>[ Back to Search Home ]</strong></a>
  </p>`;

  return renderLayout("Available Downloads", content);
}

export function renderSearchResults(query: string, results: YouTubeSearchResult[]): string {
  let listHtml = "";

  if (results.length === 0) {
    listHtml = `<p>No videos found for "<strong>${escapeHtml(query)}</strong>". Please try another search.</p>`;
  } else {
    listHtml = results.map((item, idx) => `
    <fieldset>
      <legend><strong>Result #${idx + 1}</strong></legend>
      <p>
        <strong>${escapeHtml(item.title)}</strong><br />
        <small>Channel: ${escapeHtml(item.channel)} | Duration: ${escapeHtml(item.duration)}</small><br /><br />
        <strong>Download Options:</strong><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=mp3"><strong>[ MP3 Audio ]</strong></a><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_qcif"><strong>[ 3GP 176x144 (2G) ]</strong></a><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_qvga"><strong>[ 3GP 320x240 ]</strong></a>
      </p>
    </fieldset>
    `).join("");
  }

  const content = `
  <fieldset>
    <legend><strong>Search Results</strong></legend>
    <p>Query: <strong>"${escapeHtml(query)}"</strong> (${results.length} found) | <a href="/">[ New Search ]</a></p>
  </fieldset>

  ${listHtml}

  <p align="center">
    <a href="/"><strong>[ Search Again ]</strong></a>
  </p>`;

  return renderLayout(`Results for ${query}`, content);
}

export function renderStatus(job: ConversionJob): string {
  let metaRefresh = "";
  let statusBox = "";

  if (job.status === "pending" || job.status === "downloading" || job.status === "converting") {
    metaRefresh = `<meta http-equiv="refresh" content="5;url=/status?jobId=${job.id}" />`;
    const statusText = job.status === "downloading" ? "Downloading YouTube video..." : "Converting video format...";
    statusBox = `
    <fieldset>
      <legend><strong>Progress Status</strong></legend>
      <p align="center">
        <strong>STATUS: ${statusText}</strong><br /><br />
        <small>Please wait... Page refreshes automatically every 5 seconds.</small><br /><br />
        <a href="/status?jobId=${job.id}"><strong>[ Manual Refresh ]</strong></a>
      </p>
    </fieldset>`;
  } else if (job.status === "completed") {
    const formatName = job.format === "mp3" ? "MP3 Audio" : job.format === "3gp_qcif" ? "3GP Video (176x144)" : "3GP Video (320x240)";
    statusBox = `
    <fieldset>
      <legend><strong>Conversion Complete!</strong></legend>
      <p align="center">
        <strong>Format:</strong> ${formatName}<br />
        <strong>File Size:</strong> ${job.fileSize || "Unknown"}<br /><br />
        <a href="/downloads/${encodeURIComponent(job.filename || "")}"><strong>[ CLICK HERE TO DOWNLOAD FILE ]</strong></a>
      </p>
    </fieldset>
    <p align="center">
      <a href="/">[ Download Another Video ]</a> | <a href="/downloads">[ View Downloads ]</a>
    </p>`;
  } else {
    statusBox = `
    <fieldset>
      <legend><strong>Conversion Error</strong></legend>
      <p>
        <strong>Error Details:</strong><br />
        <small>${escapeHtml(job.error || "An error occurred while processing the video.")}</small><br /><br />
        <a href="/"><strong>[ Try Again ]</strong></a>
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
    <p align="center"><a href="/"><strong>[ Return to Home ]</strong></a></p>
  </fieldset>`;

  return renderLayout("Error", content);
}

