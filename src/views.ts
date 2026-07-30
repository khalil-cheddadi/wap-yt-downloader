import { ConversionJob } from "./converter";
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0" />
  ${metaExtra}
  <title>${escapeHtml(title)} - WAP Tube</title>
  <style type="text/css">
    body { font-family: sans-serif; background-color: #f7f7f7; color: #111; margin: 4px; padding: 0; font-size: 13px; }
    .header { background-color: #cc0000; color: #fff; padding: 6px; font-weight: bold; text-align: center; }
    .header a { color: #fff; text-decoration: none; }
    .box { background-color: #fff; border: 1px solid #ccc; margin-top: 6px; padding: 6px; }
    .title { font-weight: bold; color: #000; }
    .meta { color: #555; font-size: 11px; margin-top: 2px; }
    .btn { display: inline-block; background-color: #0066cc; color: #ffffff; padding: 4px 8px; text-decoration: none; font-weight: bold; margin-top: 4px; border-radius: 3px; font-size: 12px; }
    .btn-green { background-color: #008800; }
    .btn-orange { background-color: #d96b00; }
    .footer { text-align: center; margin-top: 10px; font-size: 10px; color: #666; border-top: 1px solid #ccc; padding-top: 6px; }
    hr { border: 0; height: 1px; background-color: #ddd; margin: 6px 0; }
  </style>
</head>
<body>
  <div class="header">
    <a href="/">WAP TUBE DOWNLOADER</a>
  </div>
  ${bodyContent}
  <div class="footer">
    WAP-Net &bull; Optimized for Feature Phones
  </div>
</body>
</html>`;
}

export function renderHome(): string {
  const content = `
  <div class="box">
    <form action="/search" method="get">
      <b>Search YouTube:</b><br />
      <input type="text" name="q" size="18" style="width: 90%; margin: 4px 0;" /><br />
      <input type="submit" value="Search" style="padding: 4px 10px; font-weight: bold;" />
    </form>
  </div>
  <div class="box">
    <b>Features:</b>
    <ul style="margin: 4px 0; padding-left: 18px;">
      <li>Audio: <b>MP3</b> (128k)</li>
      <li>Video: <b>3GP</b> (176x144 QCIF for 2G phones)</li>
      <li>Video: <b>3GP</b> (320x240 QVGA)</li>
    </ul>
  </div>`;
  return renderLayout("Home", content);
}

export function renderSearchResults(query: string, results: YouTubeSearchResult[]): string {
  let listHtml = "";

  if (results.length === 0) {
    listHtml = `<div class="box">No videos found for "<b>${escapeHtml(query)}</b>". Try another query.</div>`;
  } else {
    listHtml = results.map((item, idx) => `
    <div class="box">
      <div class="title">${idx + 1}. ${escapeHtml(item.title)}</div>
      <div class="meta">Channel: ${escapeHtml(item.channel)} | Duration: ${escapeHtml(item.duration)}</div>
      <hr />
      <b>Download As:</b><br />
      <a class="btn btn-green" href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=mp3">MP3 Audio</a>
      <a class="btn" href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_qcif">3GP (176x144)</a>
      <a class="btn btn-orange" href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_qvga">3GP (320x240)</a>
    </div>
    `).join("");
  }

  const content = `
  <div class="box" style="background-color: #eee;">
    Search: <b>${escapeHtml(query)}</b> (${results.length} results)
    | <a href="/">New Search</a>
  </div>
  ${listHtml}
  <div class="box" style="text-align: center;">
    <a href="/">Search Again</a>
  </div>`;

  return renderLayout(`Results for ${query}`, content);
}

export function renderStatus(job: ConversionJob): string {
  let metaRefresh = "";
  let statusBox = "";

  if (job.status === "pending" || job.status === "downloading" || job.status === "converting") {
    metaRefresh = `<meta http-equiv="refresh" content="5;url=/status?jobId=${job.id}" />`;
    const statusText = job.status === "downloading" ? "Downloading YouTube video..." : "Converting to requested format...";
    statusBox = `
    <div class="box" style="text-align: center;">
      <b style="color: #0066cc;">Status: ${statusText}</b><br />
      <p class="meta">Please wait... This page refreshes automatically every 5 seconds.</p>
      <a class="btn" href="/status?jobId=${job.id}">Manual Refresh</a>
    </div>`;
  } else if (job.status === "completed") {
    const formatName = job.format === "mp3" ? "MP3 Audio" : job.format === "3gp_qcif" ? "3GP Video (176x144)" : "3GP Video (320x240)";
    statusBox = `
    <div class="box" style="text-align: center; border-color: #008800;">
      <b style="color: #008800;">Conversion Complete!</b><br /><br />
      <div class="title">${escapeHtml(job.title)}</div>
      <div class="meta">Format: ${formatName} | Size: ${job.fileSize || "Unknown"}</div>
      <br />
      <a class="btn btn-green" href="/downloads/${job.filename}" style="font-size: 14px; padding: 6px 12px;">CLICK HERE TO DOWNLOAD FILE</a>
      <br /><br />
      <a href="/" style="font-size: 11px;">Download Another Video</a>
    </div>`;
  } else {
    statusBox = `
    <div class="box" style="border-color: #cc0000;">
      <b style="color: #cc0000;">Conversion Error</b><br />
      <p style="color: #666; font-size: 12px;">${escapeHtml(job.error || "An error occurred while processing the video.")}</p>
      <a class="btn" href="/">Try Again</a>
    </div>`;
  }

  const content = `
  <div class="box">
    <b>Video:</b> ${escapeHtml(job.title)}
  </div>
  ${statusBox}`;

  return renderLayout(`Processing - ${job.title}`, content, metaRefresh);
}

export function renderError(message: string): string {
  const content = `
  <div class="box" style="border-color: #cc0000;">
    <b style="color: #cc0000;">Error</b><br />
    <p>${escapeHtml(message)}</p>
    <a class="btn" href="/">Back to Home</a>
  </div>`;
  return renderLayout("Error", content);
}
