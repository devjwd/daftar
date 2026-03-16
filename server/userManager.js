const fs = require('fs');
const path = require('path');

const USERS_DIR = path.join(__dirname, 'users');

function getUserFilePath(userId) {
  return path.join(USERS_DIR, `${userId}.json`);
}

function createOrUpdateUser(userId, data) {
  const filePath = getUserFilePath(userId);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function getUser(userId) {
  const filePath = getUserFilePath(userId);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function listUsers() {
  return fs.readdirSync(USERS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

module.exports = {
  createOrUpdateUser,
  getUser,
  listUsers
};
