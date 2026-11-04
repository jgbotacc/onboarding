// Shared staff labels: plain step names and readable local dates.
// Polish only: every label keeps its meaning, no API or behaviour change.

/** Plain names for pipeline steps shown in the traces and metrics tables. */
const STEP_NAMES: Record<string, string> = {
  read_document: "Read document",
  translate: "Translate",
  translate_in: "Translate in",
  translate_out: "Translate out",
  image_brief: "Image brief",
  generate_image: "Create image",
};

/** Turn a raw step id into a plain label; unknown steps fall back to a tidied name. */
export function stepName(raw: unknown): string {
  const id = String(raw ?? "").trim();
  if (!id) return "–";
  const known = STEP_NAMES[id];
  if (known) return known;
  const tidied = id
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
  if (!tidied) return "–";
  return tidied.charAt(0).toUpperCase() + tidied.slice(1);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Readable local date, e.g. "29 Oct, 2:40 pm".
 * Bad or empty values show a dash, never "Invalid Date".
 */
export function formatDate(value: unknown): string {
  if (value == null) return "–";
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? "–" : parts(value);
  }
  const text = String(value).trim();
  if (!text) return "–";
  const d = new Date(text);
  if (isNaN(d.getTime())) return "–";
  return parts(d);
}

function parts(d: Date): string {
  const hours = d.getHours();
  const suffix = hours < 12 ? "am" : "pm";
  const twelve = hours % 12 === 0 ? 12 : hours % 12;
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${twelve}:${minutes} ${suffix}`;
}
