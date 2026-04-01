import express from 'express';
import { timingSafeEqual } from 'crypto';
import userManager from './userManager.js';

const router = express.Router();

const requireAdmin = (req, res, next) => {
  const adminKey = String(process.env.BADGE_ADMIN_API_KEY || '');
  if (!adminKey) {
    return res.status(503).json({ error: 'Server missing BADGE_ADMIN_API_KEY' });
  }

  const provided = String(req.get('x-admin-key') || '');
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(adminKey, 'utf8');
  const valid = a.length > 0 && a.length === b.length && timingSafeEqual(a, b);

  if (!valid) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  return next();
};

router.use(requireAdmin);

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

export default router;
