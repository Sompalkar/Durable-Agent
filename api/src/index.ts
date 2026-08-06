/**
 * Entry point.
 *
 * Connect to Mongo before accepting traffic, so the first request never races
 * the connection, and shut down cleanly so `tsx watch` restarts do not leak
 * sockets.
 */

import { createApp } from './app.js';
import { env } from './config/env.js';
import { connectToDatabase, disconnectFromDatabase } from './db/mongo.js';

async function main(): Promise<void> {
	try {
		await connectToDatabase();
	} catch (error) {
		console.error(
			`\nCould not reach MongoDB at ${env.MONGODB_URI}\n` +
				`Start it with:  npm run db:up\n\n${String(error)}\n`,
		);
		process.exit(1);
	}

	const server = createApp().listen(env.PORT, () => {
		console.log(`API listening on http://localhost:${env.PORT}`);
	});

	for (const signal of ['SIGINT', 'SIGTERM'] as const) {
		process.on(signal, () => {
			server.close(() => {
				void disconnectFromDatabase().then(() => process.exit(0));
			});
		});
	}
}

void main();
