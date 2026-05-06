import express from "express";
import cors from "cors";
import type { Request, Response } from "express";
import path from "path";
import { associations } from "./model/Associations";
import sequelize from "./config/db";
import authRouter from "./routes/authRoutes";
import projectRouter from "./routes/projectRoutes";
import aiImageRoutes from './routes/aiImageRoutes';
import scriptRoutes from './routes/scriptRoutes';
import audioRoute from './routes/audioRoute';
import videoRoute from './routes/videoRoutes';
import adminRouter from './routes/adminRoutes';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 4900;
const isProd = process.env.NODE_ENV === 'production';

// ─── CORS ────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL ?? '')
  .split(',')
  .map(u => u.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Dev: allow everything
    if (!isProd) return cb(null, true);
    // No origin header (curl, server-to-server, same-origin)
    if (!origin) return cb(null, true);
    // Prod: only explicitly listed origins
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));

// ─── Static files ─────────────────────────────────────────────────────────────
// Serve generated videos
app.use('/output', express.static(path.join(process.cwd(), 'output')));

// In production serve the built React frontend from ./public
if (isProd) {
  app.use(express.static(path.join(process.cwd(), 'public')));
}


app.use('/api/auth',       authRouter);
app.use('/api',            projectRouter);
app.use('/api',            scriptRoutes);
app.use('/api/ai/image',   aiImageRoutes);
app.use('/api/ai/script',  scriptRoutes);
app.use('/api/audio',      audioRoute);
app.use('/api/video',      videoRoute);
app.use('/api/admin',      adminRouter);


app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', env: process.env.NODE_ENV ?? 'development' });
});



if (isProd) {
  app.get('/{*splat}', (_req: Request, res: Response) => {
    res.sendFile(path.join(process.cwd(), 'public', 'index.html'));
  });
} else {
  app.get('/', (_req: Request, res: Response) => {
    res.send('Server working');
  });
}


(async () => {
  try {
    associations();
    await sequelize.authenticate();
    console.log('✅ DB connected');

    // In production never alter schema automatically — use migrations instead
    if (!isProd) {
      await sequelize.sync({ alter: true });
      console.log('✅ DB synced (dev)');
    } else {
      await sequelize.sync({ force: false });
      console.log('✅ DB sync skipped alter (prod)');
    }
  } catch (err) {
    console.error('❌ Database connection error:', err);
    process.exit(1);
  }
})();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV ?? 'development'}]`);
});
