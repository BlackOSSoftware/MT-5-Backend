/**
 * Send a test FCM push to one user by email.
 *
 * Usage:
 *   node scripts/test-fcm-push.js user@email.com
 *
 * Requires:
 *   - MONGO_URI in .env
 *   - firebase-admin-key.json in backend root
 *   - UserDevice.fcm_token saved from the app after login
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import { sendUserNotification } from '../src/services/notification.service.js';

const email = String(process.argv[2] || '')
  .trim()
  .toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/test-fcm-push.js user@email.com');
  process.exit(1);
}

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI missing in .env');
  process.exit(1);
}

await mongoose.connect(uri);
const db = mongoose.connection.db;
const user = await db.collection('users').findOne({ email });
if (!user) {
  console.error('USER_NOT_FOUND', email);
  process.exit(1);
}

const devices = await db
  .collection('userdevices')
  .find({ user_id: user._id })
  .project({ fcm_token: 1, platform: 1, updatedAt: 1 })
  .toArray();

console.log('USER', String(user._id), email);
console.log(
  'DEVICES',
  devices.map((d) => ({
    platform: d.platform,
    token: d.fcm_token ? `${String(d.fcm_token).slice(0, 18)}…` : null,
    updatedAt: d.updatedAt,
  }))
);

if (!devices.length) {
  console.error(
    'NO_FCM_TOKEN — open Oceana app, login, allow notifications, then retry.'
  );
  process.exit(2);
}

const result = await sendUserNotification({
  userId: user._id,
  title: 'Oceana test',
  message: 'Push connected — notification test OK',
  data: { type: 'test' },
});

console.log('PUSH_RESULT', result);
await mongoose.disconnect();
process.exit(result?.success ? 0 : 3);
