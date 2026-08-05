import { RequireAuth } from "@/components/auth/RequireAuth";
import { AppShell } from "@/components/layout/AppShell";

/**
 * Shell for every session route.
 *
 * The sidebar lives in the layout so it keeps its state and does not remount
 * when you navigate between sessions. The guard wraps it rather than each page,
 * so no route under /sessions can forget to ask who is signed in.
 */
export default function SessionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
