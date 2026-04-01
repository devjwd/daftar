import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const USERS_DIR = path.join(__dirname, 'users');
const USER_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

function assertSafeUserId(userId) {
  const id = String(userId || '').trim();
  if (!USER_ID_RE.test(id)) {
    throw new Error('Invalid userId format');
  }
  return id;
}

function getUserFilePath(userId) {
  const safeUserId = assertSafeUserId(userId);
  const filePath = path.resolve(USERS_DIR, `${safeUserId}.json`);
  const basePath = path.resolve(USERS_DIR) + path.sep;
  if (!filePath.startsWith(basePath)) {
    throw new Error('Invalid user path');
  }
  return filePath;
}

function createOrUpdateUser(userId, data) {
  fs.mkdirSync(USERS_DIR, { recursive: true });
  const filePath = getUserFilePath(userId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUser(userId) {
  const filePath = getUserFilePath(userId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function listUsers() {
  fs.mkdirSync(USERS_DIR, { recursive: true });
  return fs.readdirSync(USERS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

export default {
  createOrUpdateUser,
  getUser,
  listUsers
};
