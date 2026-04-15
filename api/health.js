const { sendJson } = require("./_shared");

module.exports = (req, res) => {
  return sendJson(res, 200, { ok: true });
}