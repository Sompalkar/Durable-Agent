"use client";

/**
 * Message composer.
 *
 * Auto-growing textarea; Enter sends, Shift+Enter inserts a newline. While a
 * turn is running the send button becomes a stop button.
 */

import { useEffect, useRef, useState } from "react";
import { SendIcon, StopIcon } from "@/components/ui/icons";

const MAX_HEIGHT = 160;

export function Composer({
  streaming,
  onSend,
  onStop,
  disabled,
  initialValue = "",
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
    <div className="border-t border-line bg-panel px-4 py-3">
      {/* No focus ring on the wrapper. The composer is where the cursor lives
          almost all the time, so highlighting it draws the eye away from the
          conversation for no information. The border lifts slightly instead. */}
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-raised px-3 py-2 shadow-sm transition-colors focus-within:border-line-strong">
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
          className="block max-h-[160px] flex-1 resize-none bg-transparent text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint disabled:cursor-not-allowed"
        />

        {streaming ? (
          <button
            onClick={onStop}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-panel px-3.5 text-[13px] font-medium text-ink transition-colors hover:border-line-strong hover:bg-hover"
          >
            <StopIcon className="h-3.5 w-3.5" />
            Stop
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={!value.trim() || disabled}
            aria-label="Send message"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-ink shadow-sm shadow-accent/20 transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-accent/30 disabled:text-accent-ink/50 disabled:shadow-none"
          >
            <SendIcon className="h-[18px] w-[18px]" />
          </button>
        )}
      </div>

      <p className="mx-auto mt-2 max-w-3xl px-1 text-center text-[11px] text-ink-faint">
        Enter to send · Shift+Enter for a new line
      </p>
    </div>
  );
}
