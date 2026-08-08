"use client";

/**
 * Message rendering.
 *
 * Assistant replies are plain text from the model. Rather than pull in a
 * Markdown dependency, `MessageBody` handles the two things the model actually
 * emits that need structure: fenced code blocks and paragraph breaks.
 */

import { useState } from "react";
import { Markdown } from "@/lib/markdown";

function CodeBlock({
  content,
  language,
}: {
  content: string;
  language: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <figure className="relative overflow-hidden rounded-lg border border-line bg-canvas">
      {language ? (
        <figcaption className="border-b border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-ink-faint">
          {language}
        </figcaption>
      ) : null}
      <pre className="overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-[13px] leading-relaxed text-ink-soft">
          {content}
        </code>
      </pre>
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded border border-line bg-canvas text-xs font-medium text-ink-soft transition-colors hover:bg-hover hover:text-ink active:bg-raised"
        title={copied ? "Copied!" : "Copy code"}
        aria-label={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <span className="text-positive">✓</span>
        ) : (
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        )}
      </button>
    </figure>
  );
}

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
export function MessageBody({
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
            <CodeBlock
              key={index}
              content={segment.content}
              language={segment.language}
            />
          );
        }

        return (
          <Markdown
            key={index}
            text={segment.content}
            caret={streaming && isLast}
          />
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
