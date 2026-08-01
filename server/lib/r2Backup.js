// Uploads backup snapshots to a dedicated, fully private Cloudflare R2
// bucket - separate from the signage server's media bucket, which has a
// public custom domain mapped to it. Backups carry customer PII and
// password hashes, so they must never share a bucket that anything is
// exposed from publicly.
const fs = require('fs');
const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const KEY_PREFIX = 'online-order-backups/';

function isConfigured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET_NAME
  );
}

function client() {
  const endpoint = process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  return new S3Client({
    region: 'auto',
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function uploadBackup(localFilePath, filename) {
  if (!isConfigured()) return;
  const s3 = client();
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: `${KEY_PREFIX}${filename}`,
      Body: fs.readFileSync(localFilePath),
      ContentType: 'application/x-sqlite3',
    })
  );
}

// Mirrors the local rotation: keep only the most recent `keepCount` objects
// under the backups prefix in the remote bucket too.
async function pruneRemoteBackups(keepCount) {
  if (!isConfigured()) return;
  const s3 = client();
  const listing = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix: KEY_PREFIX }));
  const keys = (listing.Contents || []).map((obj) => obj.Key).sort();
  const excess = keys.length - keepCount;
  for (let i = 0; i < excess; i++) {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: keys[i] }));
  }
}

module.exports = { isConfigured, uploadBackup, pruneRemoteBackups };
