const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./crypto-utils');

const ROOT_DIR = path.join(__dirname, '..');
const ENCRYPTED_DIR = path.join(ROOT_DIR, 'encrypted');
const TARGET_ENC_FILE = path.join(ENCRYPTED_DIR, 'google-key.enc');

function findDefaultKeyFile() {
  const files = fs.readdirSync(ROOT_DIR);
  const match = files.find(f => f.startsWith('gen-lang-client-') && f.endsWith('.json'));
  if (match) return path.join(ROOT_DIR, match);
  const creds = files.find(f => f.startsWith('credentials') && f.endsWith('.json'));
  if (creds) return path.join(ROOT_DIR, creds);
  return null;
}

function main() {
  const keyFilePath = process.argv[2] || findDefaultKeyFile();
  const password = process.argv[3] || process.env.PORTFOLIO_PASSWORD;

  if (!keyFilePath || !fs.existsSync(keyFilePath)) {
    console.error('Error: Google service account key JSON file not found.');
    console.error('Usage: node scripts/encrypt-google-key.js <path-to-service-account-key.json> <password>');
    process.exit(1);
  }

  if (!password) {
    console.error('Error: Password is required as 2nd argument or PORTFOLIO_PASSWORD environment variable.');
    console.error('Usage: node scripts/encrypt-google-key.js <path-to-service-account-key.json> <password>');
    process.exit(1);
  }

  console.log(`Reading Google Service Account key from: ${keyFilePath}`);
  const keyContent = fs.readFileSync(keyFilePath, 'utf8');
  let keyJson;
  try {
    keyJson = JSON.parse(keyContent);
  } catch (e) {
    console.error('Error: Key file is not valid JSON:', e.message);
    process.exit(1);
  }

  if (!keyJson.client_email || !keyJson.private_key) {
    console.error('Error: Key file does not appear to be a valid Google Service Account key (missing client_email or private_key).');
    process.exit(1);
  }

  console.log(`Service Account Email: ${keyJson.client_email}`);
  console.log(`Project ID: ${keyJson.project_id}`);

  // Ensure encrypted dir exists
  if (!fs.existsSync(ENCRYPTED_DIR)) {
    fs.mkdirSync(ENCRYPTED_DIR, { recursive: true });
  }

  // Encrypt
  console.log(`Encrypting with AES-256-GCM (PBKDF2 100,000 iterations)...`);
  const encPayload = encrypt(keyJson, password);
  fs.writeFileSync(TARGET_ENC_FILE, JSON.stringify(encPayload, null, 2));

  // Verification test
  console.log(`Verifying decryption...`);
  const verifyPayload = JSON.parse(fs.readFileSync(TARGET_ENC_FILE, 'utf8'));
  const decrypted = decrypt(verifyPayload, password);
  if (decrypted.client_email !== keyJson.client_email) {
    throw new Error('Verification failed! Decrypted client_email does not match original.');
  }

  console.log(`✓ Successfully encrypted to: encrypted/google-key.enc`);
  console.log(`✓ Verification passed.`);
  console.log(`\nNote: Keep the raw key file (${path.basename(keyFilePath)}) out of git. The encrypted file (google-key.enc) is safe to commit.`);
}

main();
