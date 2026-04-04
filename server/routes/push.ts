import { Router } from 'express';
import { subscribe, unsubscribe } from '../services/pushNotification.js';

const router = Router();

router.post('/subscribe', async (req, res) => {
  const user = (req as unknown as { user?: { id: string; role: string } }).user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  if (user.role !== 'agent') return res.status(403).json({ error: 'Push notifications are for agents only' });

  const { subscription } = req.body;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ error: 'Invalid subscription object' });
  }

  await subscribe(user.id, subscription);
  res.json({ success: true });
});

router.post('/unsubscribe', async (req, res) => {
  const user = (req as unknown as { user?: { id: string } }).user;
  if (!user) return res.status(401).json({ error: 'Not authenticated' });

  const { endpoint } = req.body;
  if (!endpoint) return res.status(400).json({ error: 'Endpoint required' });

  await unsubscribe(user.id, endpoint);
  res.json({ success: true });
});

export default router;
