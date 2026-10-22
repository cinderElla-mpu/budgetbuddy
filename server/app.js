import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuthClient, createUserClient } from './config/supabase.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { createAuthRouter } from './routes/auth.js';
import { createApiRouter } from './routes/api.js';

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

export function createApp({ env = process.env, authClient, userClientFactory } = {}) {
  const app = express();
  const configuredOrigins = (env.FRONTEND_ORIGIN ?? 'http://localhost:3000')
    .split(',').map((origin) => origin.trim()).filter(Boolean);
  const devOrigins = env.NODE_ENV === 'development'
    ? ['http://localhost:5500', 'http://127.0.0.1:5500']
    : [];
  const origins = [...new Set([...configuredOrigins, ...devOrigins])];
  const supabaseOrigin = env.SUPABASE_URL ? new URL(env.SUPABASE_URL).origin : 'https://*.supabase.co';

  app.disable('x-powered-by');
  app.set('trust proxy', Number(env.TRUST_PROXY_HOPS) || 0);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://unpkg.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", supabaseOrigin, 'https://*.supabase.co'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    } },
  }));
  app.use(cors({ origin: origins, methods: ['GET', 'POST', 'PATCH', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type'] }));
  app.use(express.json({ limit: '32kb' }));
  const verifiedAuthClient = authClient ?? createAuthClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  const createScopedClient = userClientFactory ?? ((token) => createUserClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, token));
  const authenticate = createAuthMiddleware({ authClient: verifiedAuthClient, createUserClient: createScopedClient });

  app.use('/api/auth', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfterSeconds = resetTime instanceof Date
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(options.statusCode).json({ error: {
        code: 'RATE_LIMITED',
        message: `Too many sign-in or registration attempts. Try again in about ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        retry_after_seconds: retryAfterSeconds,
      } });
    },
  }), createAuthRouter(verifiedAuthClient));
  app.get('/api/health', (_req, res) => res.json({ data: { status: 'ok' } }));
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, _next, options) => {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfterSeconds = resetTime instanceof Date
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.ceil(options.windowMs / 1000);
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(options.statusCode).json({ error: {
        code: 'RATE_LIMITED',
        message: `Too many API requests. Try again in about ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
        retry_after_seconds: retryAfterSeconds,
      } });
    },
  }));
  app.use('/api', authenticate, createApiRouter());
  app.use(express.static(publicDirectory, { index: 'index.html' }));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}