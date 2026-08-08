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
import { CopyIcon, CheckIcon } from "@/components/ui/icons";

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

/** Code block with copy button. */
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
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded border border-line bg-canvas text-ink-soft transition-colors hover:bg-hover hover:text-ink"
        title={copied ? "Copied!" : "Copy code"}
        aria-label={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <CheckIcon className="h-4 w-4 text-positive" />
        ) : (
          <CopyIcon className="h-4 w-4" />
        )}
      </button>
      <pre className="overflow-x-auto px-3 py-2.5 pr-12">
        <code className="font-mono text-[13px] leading-relaxed text-ink-soft">
          {content}
        </code>
      </pre>
    </figure>
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
