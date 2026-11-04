// Shared page header (design C): logo, product name, page label and an
// optional right-side slot (language picker on the client page, the demo
// badge on the staff/designer pages). Used by the client, staff and designer
// pages; the staff/designer sign-in screen renders under the page header.
import type { ReactNode } from "react";

const ASSET = import.meta.env.BASE_URL;

export default function Header({ title, label, right }: {
  /** Product or page name shown in the header. */
  title: ReactNode;
  /** Page label shown after the name (status pill on the client page). */
  label?: ReactNode;
  /** Right-side content (language picker, demo badge). */
  right?: ReactNode;
}) {
  return (
    <header className="header">
      <img className="header-avatar" src={ASSET + "agent-64.png"} alt="" aria-hidden="true" width={32} height={32} />
      <h1>{title}</h1>
      {label}
      {right ? <div className="header-right">{right}</div> : null}
    </header>
  );
}
