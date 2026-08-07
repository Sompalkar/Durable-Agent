"use client";

/**
 * Who is signed in.
 *
 * The session token is an httpOnly cookie, so the browser can neither read it
 * nor forge it — which also means the only way to learn who you are is to ask
 * the API. That happens once on mount; every component reads the answer from
 * this context rather than refetching.
 */

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api } from "@/lib/api";
import type { AuthUser } from "@/lib/types";

interface AuthState {
  user: AuthUser | null;
  /** True until the first `me()` resolves. Distinguishes "loading" from "signed out". */
  loading: boolean;
  signIn: (input: { email: string; password: string }) => Promise<void>;
  signUp: (input: {
    email: string;
    password: string;
    name?: string;
  }) => Promise<void>;
  signOut: () => Promise<void>;
  /** Replace the cached user after a profile or settings change. */
  setUser: (user: AuthUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>.");
  return context;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const current = await api.me();
        if (!cancelled) setUser(current);
      } catch {
        // A network failure is not a signed-out state, but there is nothing
        // useful to show either — treat it as anonymous and let the page's own
        // error handling surface the outage.
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(
    async (input: { email: string; password: string }) => {
      setUser(await api.login(input));
    },
    [],
  );

  const signUp = useCallback(
    async (input: { email: string; password: string; name?: string }) => {
      setUser(await api.register(input));
    },
    [],
  );

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
    router.push("/login");
  }, [router]);

  const value = useMemo(
    () => ({ user, loading, signIn, signUp, signOut, setUser }),
    [user, loading, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
