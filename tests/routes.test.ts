import { describe, expect, it } from "bun:test";
import app, { parseCookie } from "../src/index";

describe("parseCookie", () => {
  it("parses cookies correctly", () => {
    const header = "wap_thumbs=1; other=abc; session=xyz123";
    expect(parseCookie(header, "wap_thumbs")).toBe("1");
    expect(parseCookie(header, "other")).toBe("abc");
    expect(parseCookie(header, "session")).toBe("xyz123");
    expect(parseCookie(header, "nonexistent")).toBeNull();
  });

  it("handles null or empty cookie header", () => {
    expect(parseCookie(null, "wap_thumbs")).toBeNull();
    expect(parseCookie("", "wap_thumbs")).toBeNull();
  });
});

describe("Route Integration & Smoke Tests", () => {
  it("GET / returns 200 HTML homepage", async () => {
    const req = new Request("http://localhost:3000/");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("WAP TUBE");
    expect(html).toContain("YouTube Search");
  });

  it("GET /downloads returns 200 HTML downloads page", async () => {
    const req = new Request("http://localhost:3000/downloads");
    const res = await app.fetch(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("MY DOWNLOADS");
  });

  it("GET /search without query redirects to /", async () => {
    const req = new Request("http://localhost:3000/search");
    const res = await app.fetch(req);

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/");
  });

  it("GET /nonexistent returns 404 error page", async () => {
    const req = new Request("http://localhost:3000/nonexistent");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);
    const html = await res.text();
    expect(html).toContain("Page not found");
  });
});

describe("Input Validation & Security Tests", () => {
  it("GET /convert without video ID returns error notice", async () => {
    const req = new Request("http://localhost:3000/convert");
    const res = await app.fetch(req);

    const html = await res.text();
    expect(html).toContain("Invalid video ID");
  });

  it("GET /convert creates job and redirects for valid request", async () => {
    const req = new Request("http://localhost:3000/convert?id=abc123xyz&format=mp3&title=Test+Video");
    const res = await app.fetch(req);

    expect(res.status).toBe(302);
    const location = res.headers.get("Location");
    expect(location).toContain("/status?jobId=");
  });

  it("GET /status without jobId returns missing job error", async () => {
    const req = new Request("http://localhost:3000/status");
    const res = await app.fetch(req);

    const html = await res.text();
    expect(html).toContain("Missing job ID");
  });

  it("GET /status with invalid/expired jobId returns not found notice", async () => {
    const req = new Request("http://localhost:3000/status?jobId=fake-job-id-999");
    const res = await app.fetch(req);

    const html = await res.text();
    expect(html).toContain("Job not found or expired");
  });

  it("GET /downloads/.. directory traversal attempt is blocked with 403", async () => {
    // Attack vector: URL-encode the slash (%2F) so URL constructor doesn't normalize the path out
    const req = new Request("http://localhost:3000/downloads/..%2Fpackage.json");
    const res = await app.fetch(req);

    expect(res.status).toBe(403);
    const body = await res.text();
    expect(body).toBe("Access denied");
  });

  it("GET /downloads/nonexistent.3gp returns 404", async () => {
    const req = new Request("http://localhost:3000/downloads/not_real_test_file.3gp");
    const res = await app.fetch(req);

    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).toContain("File not found or expired");
  });
});
