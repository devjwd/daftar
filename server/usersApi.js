const express = require('express');
const userManager = require('./userManager');

const router = express.Router();

router.get('/:userId', (req, res) => {
  const user = userManager.getUser(req.params.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

router.post('/:userId', (req, res) => {
  userManager.createOrUpdateUser(req.params.userId, req.body);
  res.json({ success: true });
});

router.get('/', (req, res) => {
  const users = userManager.listUsers();
  res.json(users);
});

module.exports = router;
