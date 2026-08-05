"use client";

/**
 * Message rendering.
 *
 * Assistant replies are plain text from the model. Rather than pull in a
 * Markdown dependency, `MessageBody` handles the two things the model actually
 * emits that need structure: fenced code blocks and paragraph breaks.
 */

import { classNames } from "@/lib/format";

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="animate-in flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-line bg-raised px-4 py-2.5">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
          {text}
        </p>
      </div>
    </div>
  );
}

export function AssistantMessage({
  text,
  streaming = false,
  children,
}: {
  text: string;
  streaming?: boolean;
  /** Tool timeline for this turn, rendered above the reply. */
  children?: React.ReactNode;
}) {
  return (
    <div className="animate-in space-y-2">
      {children}
      {text || streaming ? (
        <div className="max-w-[92%]">
          <MessageBody text={text} streaming={streaming} />
        </div>
      ) : null}
    </div>
  );
}

/** Splits text into fenced code blocks and prose. */
function MessageBody({
  text,
  streaming,
}: {
  text: string;
  streaming: boolean;
}) {
  const segments = splitFences(text);

  return (
    <div className="space-y-3">
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;

        if (segment.type === "code") {
          return (
            <figure
              key={index}
              className="overflow-hidden rounded-lg border border-line bg-canvas"
            >
              {segment.language ? (
                <figcaption className="border-b border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
                  {segment.language}
                </figcaption>
              ) : null}
              <pre className="overflow-x-auto px-3 py-2.5">
                <code className="font-mono text-[13px] leading-relaxed text-ink-soft">
                  {segment.content}
                </code>
              </pre>
            </figure>
          );
        }

        return (
          <p
            key={index}
            className={classNames(
              "whitespace-pre-wrap text-[15px] leading-relaxed text-ink",
              streaming && isLast && "caret",
            )}
          >
            {segment.content}
          </p>
        );
      })}
    </div>
  );
}

type Segment =
  | { type: "text"; content: string }
  | { type: "code"; content: string; language: string };

/**
 * Split on triple-backtick fences. An unterminated fence (mid-stream) is
 * treated as a code block so the layout does not jump when it closes.
 */
function splitFences(text: string): Segment[] {
  const segments: Segment[] = [];
  const pattern = /```(\w*)\n?([\s\S]*?)(?:```|$)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    const prose = text.slice(cursor, match.index).trim();
    if (prose) segments.push({ type: "text", content: prose });
    segments.push({
      type: "code",
      language: match[1] ?? "",
      content: match[2].replace(/\n$/, ""),
    });
    cursor = pattern.lastIndex;
  }

  const tail = text.slice(cursor).trim();
  if (tail) segments.push({ type: "text", content: tail });
  if (segments.length === 0) segments.push({ type: "text", content: text });

  return segments;
}
