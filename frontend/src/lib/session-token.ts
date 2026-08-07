"use client";

/**
 * The session token, for deployments where a cookie cannot reach the backend.
 *
 * When everything is served from one origin the httpOnly cookie does all of
 * this and nothing here is used — `read()` returns null and no header is sent.
 * That is the preferred setup, because a cookie a script cannot read is a
 * cookie XSS cannot steal.
 *
 * Split across three hosts there is no shared site, so the token has to travel
 * as a header, which means it has to be somewhere JavaScript can reach. That is
 * a real trade-off and not a free one: the fix is a shared domain, not a
 * cleverer storage key.
 */

const KEY = "da-token";

export function readSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    // Private browsing and blocked storage both throw here. The cookie may
    // still work, so this is not fatal.
    return null;
  }
}

export function writeSessionToken(token: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(KEY, token);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
