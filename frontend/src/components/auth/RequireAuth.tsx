"use client";

/**
 * Route guard for the signed-in app.
 *
 * This is a UX gate, not a security boundary. Nothing here protects data — the
 * Worker verifies the JWT on every request and derives Durable Object names
 * from it, so an unauthenticated caller gets a 401 no matter what the browser
 * renders. This exists only so people see a login form instead of a wall of
 * failed requests.
 */

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { LoadingDots } from "@/components/ui/Feedback";
import { useAuth } from "@/lib/useAuth";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading || user) return;
    // Remember where they were headed, so signing in resumes it.
    router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return (
      <div className="flex h-full items-center justify-center text-ink-faint">
        <LoadingDots />
      </div>
    );
  }

  return <>{children}</>;
}
