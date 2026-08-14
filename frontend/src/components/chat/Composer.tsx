"use client";

/**
 * Message composer.
 *
 * Auto-growing textarea; Enter sends, Shift+Enter inserts a newline. While a
 * turn is running the send button becomes a stop button.
 *
 * The box is a single card floating over the conversation rather than a bar
 * welded to the bottom edge, and the session's controls sit inside it on their
 * own row. Putting the model and effort here rather than in the page header is
 * the point: they describe the message you are about to send, so they belong
 * next to the send button, where you look anyway.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowUpIcon, StopIcon } from "@/components/ui/icons";

const MAX_HEIGHT = 200;

export function Composer({
  streaming,
  onSend,
  onStop,
  disabled,
  initialValue = "",
  controls,
}: {
  streaming: boolean;
  onSend: (message: string) => void;
  onStop: () => void;
  disabled?: boolean;
  /**
   * Starting text, used to hand the composer a task pulled from an issue —
   * prefilled for editing rather than sent, because it is a starting point the
   * user usually wants to narrow first.
   *
   * Applied by remounting from the caller (a changing `key`) rather than by
   * syncing in an effect, which React 19 rejects outright.
   */
  initialValue?: string;
  /** Per-message settings, rendered on the toolbar row beside Send. */
  controls?: React.ReactNode;
}) {
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus on mount only when something was prefilled, so an ordinary page load
  // does not steal the caret. Placing the caret at the end lets the user keep
  // typing rather than overwrite what arrived.
  useEffect(() => {
    if (!initialValue) return;
    const element = textareaRef.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(initialValue.length, initialValue.length);
    // Mount-only: remounting is what delivers a new value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grow with the content up to a ceiling, then scroll. Reset to 0 first so the
  // measured scrollHeight reflects the content only, never the previous height.
  useEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT)}px`;
  }, [value]);

  const submit = () => {
    const message = value.trim();
    if (!message || streaming || disabled) return;
    onSend(message);
    setValue("");
  };

  return (
    <div className="shrink-0 bg-canvas px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
      {/* The focus indicator belongs on the card, not on the textarea: the
          textarea opts out of the global outline (see globals.css) and this
          border carries the state instead.

          Deliberately not `overflow-hidden`. Clipping the card would look
          tidier, but the model picker on the toolbar row opens upward out of
          this box — hiding the overflow hides the entire menu. */}
      <div className="mx-auto max-w-3xl rounded-2xl border border-line bg-panel shadow-soft transition-colors focus-within:border-accent/60">
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          disabled={disabled}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Ask the agent to build, search, or edit something…"
          className="block max-h-[200px] w-full resize-none bg-transparent px-4 pb-1 pt-3.5 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint focus-visible:outline-none disabled:cursor-not-allowed"
        />

        <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
          <p className="hidden min-w-0 flex-1 truncate pl-1.5 text-[11px] text-ink-faint sm:block">
            Enter to send · Shift+Enter for a new line
          </p>
          <span className="flex-1 sm:hidden" />

          {controls ? <div className="shrink-0">{controls}</div> : null}

          {streaming ? (
            <button
              onClick={onStop}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-line bg-raised px-3.5 text-[13px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-hover"
            >
              <StopIcon className="h-3.5 w-3.5" />
              Stop
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!value.trim() || disabled}
              aria-label="Send message"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-canvas transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-raised disabled:text-ink-faint disabled:opacity-100"
            >
              <ArrowUpIcon className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
