import express from 'express';
import cors from 'cors';
import path from 'path';
import routes from './routes/index.js';
import { DOWNLOADS_DIR, DOWNLOADS_ROUTE } from './modules/app-update/index.js';

const app = express();
// updated
app.disable('x-powered-by');

app.use(
  cors({
origin: [
  "http://localhost:3000",
  "http://localhost:3001",
  "https://trade-portal-uiub.vercel.app",
  "https://admin-dashboard-wheat-pi-59.vercel.app",
  "http://localhost:5173",
  "https://fptrades.com",
  "https://admin.fptrades.com",
  "https://admin.fptradess.com",
  "https://user.fptrades.com",
  "https://user.fptradess.com",
],

    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    // Frontend preflight may include Cache-Control/Pragma; allow them explicitly to avoid CORS failures.
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'Pragma'],
    credentials: true
  })
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
