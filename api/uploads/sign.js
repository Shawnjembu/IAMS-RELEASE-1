// POST /api/uploads/sign
// Creates a signed Supabase Storage upload URL for report/logbook/profile files.
// The app stores the returned storage_path in the database. View links are generated
// later through the API, so private buckets stay private and supervisors can open files.
const { adminClient, send, readBody, rateLimit } = require("../_shared");

const DEFAULT_BUCKET = "iams-attachments";
const MAX_SIZE = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const ALLOWED_EXT = new Set([".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png", ".webp"]);

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

async function ensureBucket(sb, bucket) {
  const { data, error } = await sb.storage.getBucket(bucket);
  if (!error && data) return;
  const { error: createErr } = await sb.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: MAX_SIZE,
    allowedMimeTypes: Array.from(ALLOWED_MIME),
  });
  if (createErr && !String(createErr.message || "").toLowerCase().includes("already")) {
    throw createErr;
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });
    if (!rateLimit(req, res, "upload-sign", 20, 60 * 60 * 1000)) return;

    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const sb = adminClient();
    const { data: { user }, error: authErr } = await sb.auth.getUser(auth);
    if (authErr || !user) return send(res, 401, { ok: false, error: "Invalid token" });

    const body        = await readBody(req);
    const bucket      = String(body.bucket || DEFAULT_BUCKET).trim() || DEFAULT_BUCKET;
    const filename    = String(body.filename || "").trim();
    const contentType = String(body.content_type || "application/octet-stream").trim();
    const fileSize    = Number(body.size || 0);

    if (!filename) return send(res, 400, { ok: false, error: "filename is required" });
    if (fileSize && fileSize > MAX_SIZE) return send(res, 400, { ok: false, error: "File is too large. Maximum size is 10 MB." });

    const ext = extOf(filename);
    if (!ALLOWED_EXT.has(ext)) {
      return send(res, 400, { ok: false, error: "Only PDF, DOC, DOCX, JPG, PNG, and WEBP files are allowed." });
    }
    // Some browsers send DOCX as application/octet-stream. Accept valid extensions, but block clearly unsafe MIME types.
    if (contentType && contentType !== "application/octet-stream" && !ALLOWED_MIME.has(contentType)) {
      return send(res, 400, { ok: false, error: "Unsupported file type: " + contentType });
    }

    await ensureBucket(sb, bucket);

    const safeFile = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const folder   = body.kind === "profile" ? "profile" : "submissions";
    const storagePath = `${user.id}/${folder}/${Date.now()}_${safeFile}`;

    const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(storagePath);
    if (error) return send(res, 500, { ok: false, error: error.message });

    return send(res, 200, {
      ok: true,
      bucket,
      upload_url: data.signedUrl,
      storage_path: storagePath,
      file_url: storagePath,
      // The old keys are kept so older frontend code does not break.
      public_url: storagePath,
      download_url: storagePath,
    });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
