import express from 'express';
import cors from 'cors';
import path from 'path';
import routes from './routes/index.js';
import { DOWNLOADS_DIR, DOWNLOADS_ROUTE } from './modules/app-update/index.js';

const app = express();
// updated
app.disable('x-powered-by');

const staticOrigins = new Set([
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "https://trade-portal-uiub.vercel.app",
  "https://admin-dashboard-wheat-pi-59.vercel.app",
  "http://localhost:5173",
  "https://fptrades.com",
  "https://admin.fptrades.com",
  "https://admin.fptradess.com",
  "https://user.fptrades.com",
  "https://user.fptradess.com",
  "https://user.oceanaprofx.com",
  "https://admin.oceanaprofx.com",
  "https://oceanaprofx.com",
]);

function isLocalDevOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    if (!["localhost", "127.0.0.1"].includes(u.hostname) && !/^192\.168\./.test(u.hostname) && !/^10\./.test(u.hostname) && !/^172\.(1[6-9]|2\d|3[0-1])\./.test(u.hostname)) {
      return false;
    }
    return u.port === "3000" || u.port === "3001" || u.port === "5173";
  } catch {
    return false;
  }
}

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || staticOrigins.has(origin) || isLocalDevOrigin(origin)) {
        return cb(null, true);
      }
      return cb(null, false);
    },

    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    // Frontend preflight may include Cache-Control/Pragma/x-broker-id.
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Cache-Control",
      "Pragma",
      "x-broker-id",
      "X-Broker-Id",
    ],
    credentials: true,
  }),
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

app.use('/api', routes);

// APK release files (public/downloads/*.apk) - app update yahin se download karta hai.
app.use(
  DOWNLOADS_ROUTE,
  express.static(path.resolve(DOWNLOADS_DIR), {
    index: false,
    dotfiles: 'deny',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.apk')) {
        res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      }
    },
  }),
);

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

export default app;
