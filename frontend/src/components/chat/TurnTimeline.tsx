"use client";

/**
 * A turn rendered in the order it happened.
 *
 * The model rarely does everything at once: it says what it is about to do,
 * does it, looks at the result, then says what is next. Showing all the tools
 * in one block and all the prose in another throws that sequence away — the
 * reasoning stops lining up with the work it explains. This keeps them
 * interleaved, which is both truer and far easier to follow.
 */

import type { TurnSegment } from "@/lib/useAgentStream";
import { MessageBody } from "./Message";
import { ToolActivityList } from "./ToolActivityList";

export function TurnTimeline({
  segments,
  sessionId,
  streaming = false,
}: {
  segments: TurnSegment[];
  /** Passed down so a file-write row can show its diff inline. */
  sessionId: string;
  streaming?: boolean;
}) {
  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (segment.kind === "tool") {
          return (
            <ToolActivityList
              key={segment.activity.id}
              activities={[segment.activity]}
              sessionId={sessionId}
            />
          );
        }

        // A caret belongs only on the very last text run while the turn is live,
        // so earlier prose does not each sprout its own blinking cursor.
        const isLastText =
          streaming && !segments.slice(index + 1).some((s) => s.kind === "text");

        return (
          <div key={`text-${index}`} className="max-w-[92%]">
            <MessageBody text={segment.text} streaming={isLastText} />
          </div>
        );
      })}
    </div>
  );
}
