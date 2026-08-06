/**
 * Password hashing.
 *
 * bcrypt with a cost of 12 — slow enough to make offline cracking expensive,
 * fast enough that a login still feels instant (~200ms on a laptop).
 *
 * Verification always runs the full comparison, even for an email that does not
 * exist, so response time cannot be used to enumerate accounts. See
 * `verifyPasswordAgainstNothing`.
 */

import bcrypt from 'bcryptjs';

const COST = 12;

/**
 * A hash of a value nobody knows, compared against when the email is unknown.
 * Generated once at module load so the timing matches a real check.
 */
const DUMMY_HASH = bcrypt.hashSync('unused-placeholder-for-timing-parity', COST);

export async function hashPassword(plain: string): Promise<string> {
	return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
	return bcrypt.compare(plain, hash);
}

/**
 * Burn the same time as a real verification when the user does not exist.
 * Without this, "unknown email" returns in 1ms and "wrong password" in 200ms,
 * which tells an attacker which emails are registered.
 */
export async function verifyPasswordAgainstNothing(plain: string): Promise<void> {
	await bcrypt.compare(plain, DUMMY_HASH);
}
