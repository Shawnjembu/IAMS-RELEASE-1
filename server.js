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
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

const PORT = 3000;
const PUBLIC = path.join(__dirname, "public");
const API    = path.join(__dirname, "api");

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Attach parsed query object to req for API handlers that use req.query
  const query = {};
  url.searchParams.forEach((val, key) => { query[key] = val; });
  req.query = query;

  // --- API routes ---
  if (pathname.startsWith("/api/")) {
    const route = pathname.replace(/^\/api/, "");          // e.g. /health
    const candidates = [
      path.join(API, route + ".js"),                       // /api/health.js
      path.join(API, route, "index.js"),                   // /api/health/index.js
      path.join(API, route.replace(/^\//, "") + ".js"),    // fallback
    ];
    const handler = candidates.find((f) => fs.existsSync(f));
    if (handler) {
      try {
        // Clear entire api/ directory from require cache so edits (including
        // shared helpers like _shared.js) take effect without a server restart.
        // Use path.resolve for reliable cross-platform path comparison.
        const apiDir = path.resolve(API);
        Object.keys(require.cache).forEach(k => {
          try { if (path.resolve(k).startsWith(apiDir)) delete require.cache[k]; } catch (_) {}
        });
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
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.statusCode = 404;
    res.end("Not found: " + pathname);
  }
});

server.listen(PORT, () => {
  console.log(`IAMS running at http://localhost:${PORT}`);
});
