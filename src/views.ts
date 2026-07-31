import { ConversionJob, DownloadedFileItem, NextCleanupInfo, PaginatedDownloads } from "./converter";
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

export function renderHome(): string {
  const content = `
  <fieldset>
    <legend><strong>YouTube Search</strong></legend>
    <form action="/search" method="get">
      <p>
        <label for="q"><strong>Search Query:</strong></label><br />
        <input type="text" id="q" name="q" size="20" accesskey="3" /><br />
        <small>(Accesskey 3: Focus Search Box)</small><br /><br />
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
      <li><strong>Audio:</strong> MP3 (128 kbps)</li>
      <li><strong>2G Video:</strong> 3GP (176x144 QCIF)</li>
      <li><strong>Mobile Video:</strong> 3GP (320x240 QVGA)</li>
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

export function renderDownloadsList(paginatedDownloads: PaginatedDownloads, cleanupInfo: NextCleanupInfo): string {
  const { items: files, currentPage: page, totalPages, totalItems } = paginatedDownloads;
  let listHtml = "";

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

  ${totalItems > paginatedDownloads.pageSize ? paginationBar + "<br />" : ""}
  ${listHtml}
  ${totalItems > paginatedDownloads.pageSize ? "<br />" + paginationBar : ""}

  <p align="center">
    <a href="/" accesskey="1"><strong>[1] Back to Search Home</strong></a>
  </p>`;

  return renderLayout("Available Downloads", content);
}

export function renderSearchResults(query: string, searchData: PaginatedSearchResults): string {
  const { results, page, hasNextPage } = searchData;
  let listHtml = "";

  if (results.length === 0) {
    listHtml = `<p>No videos found for "<strong>${escapeHtml(query)}</strong>". Please try another search.</p>`;
  } else {
    listHtml = results.map((item, idx) => {
      const itemNum = (page - 1) * searchData.pageSize + idx + 1;
      return `
    <fieldset>
      <legend><strong>Result #${itemNum}</strong></legend>
      <p>
        <strong>${escapeHtml(item.title)}</strong><br />
        <small>Channel: ${escapeHtml(item.channel)} | Duration: ${escapeHtml(item.duration)}</small><br /><br />
        <strong>Download Options:</strong><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=mp3"><strong>[ MP3 Audio ]</strong></a><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_qcif"><strong>[ 3GP 176x144 (2G) ]</strong></a><br />
        &bull; <a href="/convert?id=${escapeHtml(item.id)}&title=${encodeURIComponent(item.title)}&format=3gp_qvga"><strong>[ 3GP 320x240 ]</strong></a>
      </p>
    </fieldset>`;
    }).join("");
  }

  const paginationBar = renderPaginationBar(`/search?q=${encodeURIComponent(query)}`, page, null, hasNextPage);

  const content = `
  <fieldset>
    <legend><strong>Search Results</strong></legend>
    <p>Query: <strong>"${escapeHtml(query)}"</strong> | <a href="/" accesskey="1">[1] New Search</a></p>
  </fieldset>

  ${results.length > 0 ? paginationBar + "<br />" : ""}
  ${listHtml}
  ${results.length > 0 ? "<br />" + paginationBar : ""}

  <p align="center">
    <a href="/" accesskey="1"><strong>[1] Search Again</strong></a>
  </p>`;

  return renderLayout(`Results for ${query} (Page ${page})`, content);
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

