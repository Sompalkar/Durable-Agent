import { SessionView } from "@/components/SessionView";

/**
 * One session. `params` is async in Next 16, so the page awaits it and hands
 * the id to the client component that owns the live state.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionView sessionId={sessionId} />;
}
