/**
 * Express application.
 *
 * Kept separate from `index.ts` so the app can be constructed without opening a
 * port — useful for tests, and it keeps startup ordering (connect, then listen)
 * in one obvious place.
 */

import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import { env } from './config/env.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';
import { authRoutes } from './modules/auth/routes.js';
import { githubRoutes } from './modules/github/routes.js';
import { internalRoutes } from './modules/internal/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { sessionRoutes } from './modules/sessions/routes.js';

export function createApp(): Express {
	const app = express();

	// Behind a proxy in production, so `secure` cookies and client IPs work.
	app.set('trust proxy', 1);
	app.disable('x-powered-by');

	app.use(
		cors({
			// A credentialed request cannot use a wildcard origin, so the allow-list
			// is echoed back per request.
			origin: env.CORS_ORIGINS,
			credentials: true,
		}),
	);

	// Bodies are small JSON documents; the cap keeps a bad client cheap.
	app.use(express.json({ limit: '1mb' }));
	app.use(cookieParser());

	app.get('/health', (_req, res) => {
		res.json({ ok: true, service: 'durable-agent-api' });
	});

	app.use('/api/auth', authRoutes);
	app.use('/api/profile', profileRoutes);
	app.use('/api/github', githubRoutes);
	app.use('/api/sessions', sessionRoutes);
	app.use('/internal', internalRoutes);

	app.use(notFoundHandler);
	app.use(errorHandler);

	return app;
}
