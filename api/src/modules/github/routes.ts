/**
 * Connecting a GitHub account.
 *
 * The token is validated against GitHub before it is stored, so a typo or an
 * expired token fails here — at the moment the user can fix it — rather than
 * three steps later when the agent tries to open a pull request.
 *
 * Nothing in this module ever returns the token. The Worker reads it over the
 * internal service channel; a browser only ever learns that a connection exists.
 */

import { Router } from 'express';
import { z } from 'zod';
import { collections } from '../../db/mongo.js';
import { ApiError } from '../../lib/errors.js';
import { requireUser } from '../../middleware/auth.js';
import { route } from '../../middleware/error.js';
import { toPublicUser } from '../../models/user.js';

export const githubRoutes = Router();

githubRoutes.use(requireUser);

const connectBody = z.object({
	token: z.string().trim().min(20, 'That does not look like a GitHub token.'),
});

/**
 * POST /api/github/connect
 *
 * Scopes are read from GitHub's response header rather than asked for, because
 * what the user believes they granted and what the token actually carries are
 * routinely different.
 */
githubRoutes.post(
	'/connect',
	route(async (req, res) => {
		const { token } = connectBody.parse(req.body);

		const response = await fetch('https://api.github.com/user', {
			headers: {
				Authorization: `Bearer ${token}`,
				Accept: 'application/vnd.github+json',
				'User-Agent': 'durable-agent',
			},
			signal: AbortSignal.timeout(10_000),
		}).catch(() => null);

		if (!response) {
			throw ApiError.badRequest('Could not reach GitHub. Check your connection.', 'github_unreachable');
		}
		if (response.status === 401) {
			throw ApiError.badRequest('GitHub rejected that token.', 'github_bad_token');
		}
		if (!response.ok) {
			throw ApiError.badRequest(`GitHub returned ${response.status}.`, 'github_error');
		}

		const account = (await response.json()) as { login?: string };
		if (!account.login) {
			throw ApiError.badRequest('GitHub did not identify that token.', 'github_error');
		}

		const scopes = (response.headers.get('x-oauth-scopes') ?? '')
			.split(',')
			.map((scope) => scope.trim())
			.filter(Boolean);

		const user = await collections.users().findOneAndUpdate(
			{ id: req.user!.id },
			{
				$set: {
					github: { token, login: account.login, scopes, connectedAt: new Date() },
					updatedAt: new Date(),
				},
			},
			{ returnDocument: 'after' },
		);

		if (!user) throw ApiError.notFound('Account not found.');
		res.json({ user: toPublicUser(user) });
	}),
);

/** DELETE /api/github/connect — forget the token. */
githubRoutes.delete(
	'/connect',
	route(async (req, res) => {
		const user = await collections
			.users()
			.findOneAndUpdate(
				{ id: req.user!.id },
				{ $unset: { github: '' }, $set: { updatedAt: new Date() } },
				{ returnDocument: 'after' },
			);

		if (!user) throw ApiError.notFound('Account not found.');
		res.json({ user: toPublicUser(user) });
	}),
);

/**
 * GET /api/github/repos — repositories this token can push to.
 *
 * Filtered to what the user can actually open a pull request on, so the picker
 * never offers something that will fail at the last step.
 */
githubRoutes.get(
	'/repos',
	route(async (req, res) => {
		const user = await collections.users().findOne({ id: req.user!.id });
		if (!user?.github) throw ApiError.badRequest('Connect GitHub first.', 'github_not_connected');

		const response = await fetch(
			'https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
			{
				headers: {
					Authorization: `Bearer ${user.github.token}`,
					Accept: 'application/vnd.github+json',
					'User-Agent': 'durable-agent',
				},
				signal: AbortSignal.timeout(15_000),
			},
		).catch(() => null);

		if (!response?.ok) {
			throw ApiError.badRequest('Could not list your repositories.', 'github_error');
		}

		const repos = (await response.json()) as Array<{
			full_name: string;
			private: boolean;
			default_branch: string;
			permissions?: { push?: boolean };
		}>;

		res.json({
			repos: repos
				.filter((repo) => repo.permissions?.push)
				.map((repo) => ({
					fullName: repo.full_name,
					private: repo.private,
					defaultBranch: repo.default_branch,
				})),
		});
	}),
);

const newIssue = z.object({
	repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Expected owner/name.'),
	title: z.string().trim().min(1).max(200),
	body: z.string().max(20_000).default(''),
});

/**
 * POST /api/github/issues — file an issue.
 *
 * Creating an issue is visible to everyone watching the repository, so this is
 * only ever reached from an explicit user action, never from the agent loop.
 */
githubRoutes.post(
	'/issues',
	route(async (req, res) => {
		const { repo, title, body } = newIssue.parse(req.body);

		const user = await collections.users().findOne({ id: req.user!.id });
		if (!user?.github) throw ApiError.badRequest('Connect GitHub first.', 'github_not_connected');

		const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${user.github.token}`,
				Accept: 'application/vnd.github+json',
				'Content-Type': 'application/json',
				'User-Agent': 'durable-agent',
			},
			body: JSON.stringify({ title, body }),
			signal: AbortSignal.timeout(15_000),
		}).catch(() => null);

		if (!response?.ok) {
			const detail = response ? await response.text().catch(() => '') : '';
			throw ApiError.badRequest(`Could not create the issue. ${detail}`.trim(), 'github_error');
		}

		const issue = (await response.json()) as { number: number; html_url: string };
		res.status(201).json({ issue: { number: issue.number, url: issue.html_url } });
	}),
);

/** GET /api/github/issues?repo=owner/name — open issues, newest first. */
githubRoutes.get(
	'/issues',
	route(async (req, res) => {
		const repo = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'Expected owner/name.').parse(req.query.repo);

		const user = await collections.users().findOne({ id: req.user!.id });
		if (!user?.github) throw ApiError.badRequest('Connect GitHub first.', 'github_not_connected');

		const response = await fetch(
			`https://api.github.com/repos/${repo}/issues?state=open&per_page=50`,
			{
				headers: {
					Authorization: `Bearer ${user.github.token}`,
					Accept: 'application/vnd.github+json',
					'User-Agent': 'durable-agent',
				},
				signal: AbortSignal.timeout(15_000),
			},
		).catch(() => null);

		if (!response?.ok) {
			throw ApiError.badRequest(`Could not list issues for ${repo}.`, 'github_error');
		}

		const issues = (await response.json()) as Array<{
			number: number;
			title: string;
			pull_request?: unknown;
			labels: Array<{ name: string }>;
		}>;

		res.json({
			// GitHub returns pull requests from the issues endpoint. They are not
			// work to be done, so drop them.
			issues: issues
				.filter((issue) => !issue.pull_request)
				.map((issue) => ({
					number: issue.number,
					title: issue.title,
					labels: issue.labels.map((label) => label.name),
				})),
		});
	}),
);
