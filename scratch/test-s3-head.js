const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });
const { S3Client, HeadObjectCommand } = require('@aws-sdk/client-s3');

console.log("=== S3 HeadObject Diagnostic Tool ===");
const VIDEO_SOURCE = (process.env.VIDEO_SOURCE || 'local').trim();
console.log(`VIDEO_SOURCE resolved to: "${VIDEO_SOURCE}"`);

const S3_BUCKET = process.env.S3_BUCKET_NAME?.trim();
const region = (process.env.AWS_REGION || 'us-east-1').trim();
console.log(`Region: "${region}"`);
console.log(`Bucket: "${S3_BUCKET}"`);

if (!S3_BUCKET) {
  console.error("❌ ERROR: S3_BUCKET_NAME environment variable is missing!");
  process.exit(1);
}

const s3Client = new S3Client({ region });
const targetKey = 'videos/hls/MP4 Example 480p 1.5MB/index.m3u8';
console.log(`Checking key: "${targetKey}"...`);

async function run() {
  try {
    const result = await s3Client.send(new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: targetKey
    }));
    console.log("✅ SUCCESS: HLS manifest exists and is accessible!");
    console.log("Metadata returned:", result);
  } catch (err) {
    console.error("❌ ERROR checking key:");
    console.error("Name:", err.name);
    console.error("Message:", err.message);
    console.error("Full Error:", err);
  }
}

run();
