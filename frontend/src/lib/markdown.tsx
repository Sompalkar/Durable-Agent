"use client";

/**
 * Just enough Markdown for what a model actually writes.
 *
 * Hand-rolled rather than a library for two reasons. The Artifact-style CSP and
 * bundle budget make a parser a real cost for a handful of constructs, and — more
 * importantly — a full parser renders *everything*, including raw HTML. Text
 * arriving from a model is untrusted input; a renderer that only understands
 * headings, bold, code, lists and links cannot be talked into anything else.
 *
 * Code fences are handled by the caller, which needs them as separate blocks so
 * it can wrap each one in its own figure.
 */

import { classNames } from "./format";

type Block =
  | { kind: "heading"; level: 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "quote"; text: string }
  | { kind: "rule" };

/** Render a run of prose. Assumes fenced code has already been split out. */
export function Markdown({
  text,
  caret = false,
}: {
  text: string;
  /** Blinking caret on the final block, while a turn is still streaming. */
  caret?: boolean;
}) {
  const blocks = parseBlocks(text);

  return (
    <div className="space-y-2.5">
      {blocks.map((block, index) => {
        const last = caret && index === blocks.length - 1;

        switch (block.kind) {
          case "rule":
            return <hr key={index} className="border-line" />;

          case "heading":
            return (
              <h3
                key={index}
                className={classNames(
                  "font-semibold tracking-tight text-ink",
                  block.level === 2 ? "text-[17px]" : "text-[15px]",
                  index > 0 && "pt-1",
                )}
              >
                <Inline text={block.text} />
              </h3>
            );

          case "quote":
            return (
              <blockquote
                key={index}
                className="border-l-2 border-line-strong pl-3 text-[15px] leading-relaxed text-ink-soft"
              >
                <Inline text={block.text} />
              </blockquote>
            );

          case "list":
            return block.ordered ? (
              <ol key={index} className="list-decimal space-y-1 pl-5 text-[15px] leading-relaxed text-ink marker:text-ink-faint">
                {block.items.map((item, i) => (
                  <li key={i}>
                    <Inline text={item} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={index} className="space-y-1 pl-5 text-[15px] leading-relaxed text-ink">
                {block.items.map((item, i) => (
                  <li key={i} className="list-disc marker:text-accent">
                    <Inline text={item} />
                  </li>
                ))}
              </ul>
            );

          default:
            return (
              <p
                key={index}
                className={classNames(
                  "whitespace-pre-wrap text-[15px] leading-relaxed text-ink",
                  last && "caret",
                )}
              >
                <Inline text={block.text} />
              </p>
            );
        }
      })}
    </div>
  );
}

/** Bold, inline code and links, in one pass so they cannot nest wrongly. */
function Inline({ text }: { text: string }) {
  // Ordered so `**` is consumed before a lone `*`, and code before everything —
  // backticks should win, the way they do in every Markdown implementation.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));

    const [whole, code, bold, link, href] = match;

    if (code) {
      nodes.push(
        <code
          key={key++}
          className="rounded border border-line bg-raised px-1 py-0.5 font-mono text-[13px] text-ink-soft"
        >
          {code.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      // Recursed, because `**`/api`**` is common and the inner backticks should
      // render as code rather than as literal characters. Safe from runaway
      // recursion: the bold pattern cannot contain another `**`.
      nodes.push(
        <strong key={key++} className="font-semibold text-ink">
          <Inline text={bold.slice(2, -2)} />
        </strong>,
      );
    } else if (link && href) {
      nodes.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="text-accent underline decoration-accent/40 hover:decoration-accent"
        >
          {link.slice(1, link.indexOf("]"))}
        </a>,
      );
    }

    cursor = match.index + whole.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ kind: "paragraph", text: paragraph.join("\n").trim() });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list) {
      blocks.push({ kind: "list", ...list });
      list = null;
    }
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed === "") {
      flushAll();
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushAll();
      blocks.push({ kind: "rule" });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      flushAll();
      // Collapsed to two visual levels: a chat bubble is not a document, and
      // six sizes of heading inside one reply is noise.
      blocks.push({
        kind: "heading",
        level: heading[1]!.length <= 2 ? 2 : 3,
        text: heading[2]!,
      });
      continue;
    }

    if (trimmed.startsWith("> ")) {
      flushAll();
      blocks.push({ kind: "quote", text: trimmed.slice(2) });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);

    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      const item = (bullet?.[1] ?? numbered?.[1] ?? "").trim();
      // A change of list type starts a new list rather than mixing markers.
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push(item);
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}
