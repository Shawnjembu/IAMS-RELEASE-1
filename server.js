const http = require("http");
const fs = require("fs");
const path = require("path");

// Load .env file
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf-8")
    .split("\n")
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const idx = trimmed.indexOf("=");
      if (idx === -1) return;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    });
}

const MIME = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

const PORT = 3000;
const PUBLIC = path.join(__dirname, "public");
const API    = path.join(__dirname, "api");

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // Kept compatible with Supabase CDN/client scripts used by this local project.
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cdn.jsdelivr.net; font-src 'self' data:; frame-ancestors 'self';");
}

const server = http.createServer(async (req, res) => {
  setSecurityHeaders(res);
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Attach parsed query object to req for API handlers that use req.query
  const query = {};
  url.searchParams.forEach((val, key) => { query[key] = val; });
  req.query = query;

  // --- API routes ---
  if (pathname.startsWith("/api/")) {
    // Basic API payload guard: prevents accidental huge requests during file/form testing.
    const len = Number(req.headers["content-length"] || 0);
    if (len > 1024 * 1024) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "Request body too large" }));
      return;
    }
    const route = pathname.replace(/^\/api/, "");          // e.g. /health
    const candidates = [
      path.join(API, route + ".js"),                       // /api/health.js
      path.join(API, route, "index.js"),                   // /api/health/index.js
      path.join(API, route.replace(/^\//, "") + ".js"),    // fallback
    ];
    const handler = candidates.find((f) => fs.existsSync(f));
    if (handler) {
      try {
        // Keep API modules cached by default for better local speed.
        // Set DEV_HOT_RELOAD=1 in .env only when actively editing API files.
        if (process.env.DEV_HOT_RELOAD === "1") {
          const apiDir = path.resolve(API);
          Object.keys(require.cache).forEach(k => {
            try { if (path.resolve(k).startsWith(apiDir)) delete require.cache[k]; } catch (_) {}
          });
        }
        const mod = require(handler);
        const fn = mod.default || mod;
        await fn(req, res);
      } catch (err) {
        console.error("API error:", err);
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: err.message }));
      }
    } else {
      res.statusCode = 404;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ error: "API route not found: " + pathname }));
    }
    return;
  }

  // --- Static files ---
  let filePath = path.join(PUBLIC, pathname === "/" ? "index.html" : pathname);

  // If no extension, try .html
  if (!path.extname(filePath)) {
    const withHtml = filePath + ".html";
    if (fs.existsSync(withHtml)) filePath = withHtml;
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
    // During local project testing, prevent old JavaScript/CSS from being reused by the browser.
    // This avoids stale validation messages after we update workflow rules.
    if ([".js", ".css", ".html"].includes(ext)) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    } else if ([".png", ".jpg", ".jpeg", ".svg", ".ico"].includes(ext)) {
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    fs.createReadStream(filePath).pipe(res);
  } else {
    const notFound = path.join(PUBLIC, "not-found.html");
    res.statusCode = 404;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (fs.existsSync(notFound)) fs.createReadStream(notFound).pipe(res);
    else res.end("Not found: " + pathname);
  }
});

server.listen(PORT, () => {
  console.log(`IAMS running at http://localhost:${PORT}`);
});
