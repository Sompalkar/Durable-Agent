/**
 * Environment configuration.
 *
 * Read and validated once, at boot. A missing secret should stop the process
 * immediately with a readable message — not surface three hours later as a
 * confusing 500 on a login attempt.
 */

import { existsSync } from 'node:fs';
import { z } from 'zod';

// Load .env into process.env before validating. Node does this natively, so no
// dotenv dependency; in production the platform supplies the variables and the
// file simply is not there.
const ENV_FILE = new URL('../../.env', import.meta.url).pathname;
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const schema = z.object({
	NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
	PORT: z.coerce.number().default(4000),

	/** Local Docker Mongo by default; swap for an Atlas URI in .env. */
	MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017'),
	MONGODB_DB: z.string().default('durable_agent'),

	/**
	 * Signs the session JWT. The Worker verifies with the same secret, so the
	 * two services must agree — see backend/.dev.vars.
	 */
	AUTH_JWT_SECRET: z.string().min(32, 'AUTH_JWT_SECRET must be at least 32 characters'),
	/** How long a login lasts. */
	AUTH_TOKEN_TTL_DAYS: z.coerce.number().default(30),

	/**
	 * Shared secret for the Worker calling back into this API to report turns.
	 * Machine-to-machine only — never sent to a browser.
	 */
	SERVICE_TOKEN: z.string().min(16, 'SERVICE_TOKEN must be at least 16 characters'),

	/**
	 * Starting balance for a new account, in USD.
	 *
	 * Low on purpose. A public demo link with an unlimited balance is an open
	 * tap on whoever's API key is configured.
	 */
	SIGNUP_CREDITS_USD: z.coerce.number().default(2),

	/** Browser origins allowed to send credentialed requests. */
	CORS_ORIGINS: z
		.string()
		.default('http://localhost:3000')
		.transform((value) =>
			value
				.split(',')
				.map((origin) => origin.trim())
				.filter(Boolean),
		),

	/**
	 * Cookie domain. Left blank for localhost, where the browser scopes the
	 * cookie to the hostname and shares it across ports — which is how the
	 * Worker on :8787 sees a cookie set by this API on :4000.
	 */
	COOKIE_DOMAIN: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
	const issues = parsed.error.issues
		.map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
		.join('\n');
	console.error(`\nInvalid environment configuration:\n${issues}\n\nSee api/.env.example.\n`);
	process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
