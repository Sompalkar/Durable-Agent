import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/AuthForm";

export const metadata: Metadata = { title: "Sign in · Durable Agent" };

export default function LoginPage() {
  // `useSearchParams` reads the `next=` redirect target, which forces this
  // subtree to render on the client — the boundary keeps that local.
  return (
    <Suspense>
      <AuthForm mode="login" />
    </Suspense>
  );
}
