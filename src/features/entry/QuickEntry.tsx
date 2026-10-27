import { useState } from "react";
import { Icon } from "@/components/Icon";
import { parseQuickEntry } from "./quick-entry";
import type { FormValues } from "./form-model";
export function QuickEntry({
  onApply,
}: {
  onApply: (values: Partial<FormValues>) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState(false);
  return (
    <details className="quick-entry card">
      <summary>
        <Icon name="sparkle" size={18} /> Quick entry{" "}
        <span>Paste a route and date</span>
      </summary>
      <p>
        Use airport codes and an ISO date. Review the filled form before saving.
      </p>
      <label className="field">
        <span className="field__label">
          Route, date and optional flight number
        </span>
        <input
          className="input"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(false);
          }}
          placeholder="SAN → LAX 2026-11-15 UA123"
          autoComplete="off"
          aria-describedby="quick-entry-help"
        />
      </label>
      <p id="quick-entry-help">Example: SAN → LAX 2026-11-15 UA123</p>
      {error && (
        <p role="alert" className="field__error">
          Use two known airport codes, a valid YYYY-MM-DD date, and an optional
          flight number.
        </p>
      )}
      <button
        type="button"
        className="btn btn--primary"
        disabled={!text.trim()}
        onClick={() => {
          const values = parseQuickEntry(text);
          if (values) onApply(values);
          else setError(true);
        }}
      >
        Fill flight details
      </button>
    </details>
  );
}
