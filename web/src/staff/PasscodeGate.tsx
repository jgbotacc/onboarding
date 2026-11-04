import { useState } from "react";

/** [staff-key] Passcode screen shown before any staff data loads, and again after a 401. */
export function PasscodeGate({ error, onSubmit }: { error: string; onSubmit: (key: string) => void }) {
  const [key, setKey] = useState("");
  return (
    <form
      className="staff-gate"
      onSubmit={(e) => {
        e.preventDefault();
        if (key.trim()) onSubmit(key.trim());
      }}
    >
      <h2>Staff sign-in</h2>
      <p className="staff-empty">Enter your staff or designer passcode to continue.</p>
      <label htmlFor="staffKey">Passcode</label>
      <input id="staffKey" type="password" autoComplete="current-password" autoFocus value={key} onChange={(e) => setKey(e.target.value)} />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={!key.trim()}>
        Continue
      </button>
    </form>
  );
}
