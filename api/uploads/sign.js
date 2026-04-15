// POST /api/uploads/sign
// Returns a signed upload URL for Supabase Storage.
// The client uploads directly to Supabase Storage using this URL.
// Body: { bucket?, filename, content_type? }
//
// Prerequisites in Supabase:
//   1. Create a Storage bucket named "iams-attachments" (public: false)
//   2. Add bucket policy: authenticated users can upload to their own folder
const { adminClient, send, readBody } = require("../_shared");

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") return send(res, 405, { ok: false, error: "Method Not Allowed" });

    const auth = (req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (!auth) return send(res, 401, { ok: false, error: "Missing auth token" });

    const sb = adminClient();
    const { data: { user }, error: authErr } = await sb.auth.getUser(auth);
    if (authErr || !user) return send(res, 401, { ok: false, error: "Invalid token" });

    const body         = await readBody(req);
    const bucket       = String(body.bucket   || "iams-attachments");
    const filename     = String(body.filename || "").trim();
    const contentType  = String(body.content_type || "application/octet-stream");

    if (!filename) return send(res, 400, { ok: false, error: "filename is required" });

    // Sanitise: store under user folder to avoid path traversal
    const safeFile    = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${user.id}/${Date.now()}_${safeFile}`;

    const { data, error } = await sb.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);

    if (error) {
      // Friendly message if bucket doesn't exist
      if (error.message && error.message.includes("not found"))
        return send(res, 500, {
          ok: false,
          error: `Storage bucket "${bucket}" not found. Create it in the Supabase dashboard first.`
        });
      return send(res, 500, { ok: false, error: error.message });
    }

    // Generate a long-lived signed download URL (1 year = 31 536 000 s) so
    // the stored cv_url remains accessible without requiring a public bucket.
    // If this call fails we still return the upload URL — cv_url will fall back
    // to storage_path and the caller can regenerate a download URL on demand.
    let downloadUrl = null;
    const { data: dlData, error: dlErr } = await sb.storage
      .from(bucket)
      .createSignedUrl(storagePath, 31536000);
    if (!dlErr && dlData && dlData.signedUrl) {
      downloadUrl = dlData.signedUrl;
    }

    return send(res, 200, {
      ok: true,
      upload_url:   data.signedUrl,
      storage_path: storagePath,
      download_url: downloadUrl, // persisted as cv_url; valid for 1 year
      public_url:   downloadUrl, // kept for backward-compat
    });
  } catch (e) {
    return send(res, 500, { ok: false, error: e.message });
  }
};
