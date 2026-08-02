/**
 * Helpers for addressing Durable Objects.
 *
 * Every name starts with the user id. That single decision is what makes the
 * system multi-tenant: two users asking for session "abc" derive two different
 * object ids, so there is no code path — not a missing check, not a typo in a
 * route — where one account can reach another's conversation, files, memory, or
 * schedules. Isolation is structural rather than enforced.
 *
 * The brain and scheduler are per-user singletons: memory and skills are shared
 * across all of *your* sessions, and nobody else's.
 */

import type { AgentSessionDO } from '../durable-objects/agent-session-do';
import type { BrainDO } from '../durable-objects/brain-do';
import type { SchedulerDO } from '../durable-objects/scheduler-do';
import type { SessionRegistryDO } from '../durable-objects/session-registry-do';
import type { WorkspaceDO } from '../durable-objects/workspace-do';

export function sessionStub(
	env: Env,
	userId: string,
	sessionId: string,
): DurableObjectStub<AgentSessionDO> {
	return env.AGENT_SESSION.get(env.AGENT_SESSION.idFromName(`session:${userId}:${sessionId}`));
}

export function workspaceStub(
	env: Env,
	userId: string,
	sessionId: string,
): DurableObjectStub<WorkspaceDO> {
	return env.WORKSPACE.get(env.WORKSPACE.idFromName(`workspace:${userId}:${sessionId}`));
}

/**
 * The per-user rate limiter.
 *
 * The session *list* now lives in MongoDB, because "which sessions belong to
 * this user" is a query and a Durable Object cannot answer it. What stays here
 * is the hourly turn counter, which needs a single serialised point of truth —
 * exactly what a Durable Object is good at.
 */
export function registryStub(env: Env, userId: string): DurableObjectStub<SessionRegistryDO> {
	return env.SESSION_REGISTRY.get(env.SESSION_REGISTRY.idFromName(`registry:${userId}`));
}

export function brainStub(env: Env, userId: string): DurableObjectStub<BrainDO> {
	return env.BRAIN.get(env.BRAIN.idFromName(`brain:${userId}`));
}

/**
 * What the agent knows about one repository.
 *
 * The same `BrainDO` class as `brainStub`, addressed by a different name — so
 * personal memory and repository knowledge are two permanently separate stores
 * with no shared table and no filter to get wrong. The name must match the one
 * `AgentSessionDO` derives, or the UI would read an empty object while the agent
 * writes to a real one.
 */
export function repoBrainStub(
	env: Env,
	userId: string,
	fullName: string,
): DurableObjectStub<BrainDO> {
	return env.BRAIN.get(env.BRAIN.idFromName(`repo:${userId}:${fullName}`));
}

export function schedulerStub(env: Env, userId: string): DurableObjectStub<SchedulerDO> {
	return env.SCHEDULER.get(env.SCHEDULER.idFromName(`scheduler:${userId}`));
}
