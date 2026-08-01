// Implements the receiving side of Star Micronics' CloudPRNT protocol: the
// printer itself polls this URL (configured on the printer, not something a
// browser ever hits), so authentication is a per-store secret key in the
// query string rather than a session or JWT.
// Protocol reference: https://star-m.jp/products/s_print/sdk/StarCloudPRNT/manual/en/protocol-guide.html
//
// Flow: printer POSTs its status periodically ("anything to print?") -> if we
// have a pending job we say so -> printer GETs the job body -> printer DELETEs
// to confirm it printed. The job's own random token (not the store key) is
// what ties the GET/DELETE to a specific job, exactly as the protocol expects.
const express = require('express');
const db = require('../db');

const router = express.Router();

function checkKey(req, res) {
  const key = req.query.key;
  if (!key || !req.store.printer_key || key !== req.store.printer_key) {
    res.status(403).json({ error: 'Invalid or missing printer key' });
    return false;
  }
  return true;
}

router.post('/cloudprnt', (req, res) => {
  if (!checkKey(req, res)) return;
  const job = db
    .prepare("SELECT * FROM print_jobs WHERE store_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1")
    .get(req.store.id);
  if (!job) return res.json({ jobReady: false });
  res.json({ jobReady: true, mediaTypes: ['text/plain'], jobToken: job.job_token });
});

router.get('/cloudprnt', (req, res) => {
  if (!checkKey(req, res)) return;
  const token = req.query.token;
  if (!token) return res.status(400).send('missing token');
  const job = db
    .prepare("SELECT * FROM print_jobs WHERE store_id = ? AND job_token = ? AND status IN ('pending', 'delivered')")
    .get(req.store.id, token);
  if (!job) return res.status(404).send('job not found');
  db.prepare("UPDATE print_jobs SET status = 'delivered' WHERE id = ?").run(job.id);
  res.set('Content-Type', 'text/plain');
  res.send(job.content);
});

router.delete('/cloudprnt', (req, res) => {
  if (!checkKey(req, res)) return;
  const token = req.query.token;
  if (token) {
    db.prepare("UPDATE print_jobs SET status = 'done' WHERE store_id = ? AND job_token = ?").run(req.store.id, token);
  }
  res.status(200).send();
});

module.exports = router;
