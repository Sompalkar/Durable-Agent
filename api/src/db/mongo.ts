/**
 * MongoDB connection and typed collections.
 *
 * One client for the process, connected at boot. Collections are exposed as
 * typed accessors so nothing downstream has to remember collection names or
 * repeat generics.
 *
 * Indexes are created here rather than by hand, so a fresh database — or a
 * teammate's laptop, or Atlas on first deploy — is correct without a setup step.
 */

import { MongoClient, type Collection, type Db } from 'mongodb';
import { env } from '../config/env.js';
import type { SessionDoc } from '../models/session.js';
import type { TurnDoc } from '../models/turn.js';
import type { UserDoc } from '../models/user.js';

let client: MongoClient | null = null;
let database: Db | null = null;

export async function connectToDatabase(): Promise<Db> {
	if (database) return database;

	client = new MongoClient(env.MONGODB_URI, {
		// Fail fast on a wrong URI instead of hanging the boot for 30 seconds.
		serverSelectionTimeoutMS: 5_000,
	});

	await client.connect();
	database = client.db(env.MONGODB_DB);
	await ensureIndexes(database);

	return database;
}

export async function disconnectFromDatabase(): Promise<void> {
	await client?.close();
	client = null;
	database = null;
}

function db(): Db {
	if (!database) throw new Error('Database not connected. Call connectToDatabase() first.');
	return database;
}

export const collections = {
	users: (): Collection<UserDoc> => db().collection<UserDoc>('users'),
	sessions: (): Collection<SessionDoc> => db().collection<SessionDoc>('sessions'),
	turns: (): Collection<TurnDoc> => db().collection<TurnDoc>('turns'),
};

async function ensureIndexes(instance: Db): Promise<void> {
	await instance.collection<UserDoc>('users').createIndexes([
		// Emails are stored lowercased, so a plain unique index is enough to make
		// "Ada@x.com" and "ada@x.com" the same account.
		{ key: { email: 1 }, unique: true, name: 'users_email_unique' },
	]);

	await instance.collection<SessionDoc>('sessions').createIndexes([
		{ key: { id: 1 }, unique: true, name: 'sessions_id_unique' },
		// The sidebar query: this user's sessions, newest first.
		{ key: { userId: 1, updatedAt: -1 }, name: 'sessions_by_user_recent' },
	]);

	await instance.collection<TurnDoc>('turns').createIndexes([
		{ key: { sessionId: 1, createdAt: 1 }, name: 'turns_by_session' },
		// Usage roll-ups for a billing period.
		{ key: { userId: 1, createdAt: -1 }, name: 'turns_by_user_recent' },
	]);
}
