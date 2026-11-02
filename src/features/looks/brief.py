"""Three look briefs per round: the client's brief plus two alternatives."""
import json

from src.shared import meta

ALTERNATIVES = [
    ("Bold and colourful", "bold bright colours, big confident type, high contrast"),
    ("Warm and friendly", "soft warm colours, rounded shapes, friendly and welcoming"),
    ("Modern minimal", "lots of white space, one accent colour, clean thin type"),
    ("Classic and elegant", "serif type, muted tones, refined layout"),
    ("Playful", "bright colours, hand-drawn accents, fun shapes"),
    ("Premium dark", "dark background, gold or metallic accents, luxury feel"),
]

ALLOWED = ("business_name", "business_type", "industry", "design_preferences",
           "requirements_notes", "tagline", "brand_colours")


def design_context(fields, direction, feedback) -> dict:
    """Only design-safe fields plus direction/feedback; never contact details."""
    f = fields or {}
    ctx = {k: f[k] for k in ALLOWED if f.get(k)}
    ctx["direction"] = direction
    ctx["feedback"] = feedback
    return ctx


def _fallback(rejected_titles, round_n):
    """First 2 alternatives not already rejected, rotated so rounds differ."""
    n = len(ALTERNATIVES)
    off = ((round_n - 1) * 2) % n if n else 0
    rot = ALTERNATIVES[off:] + ALTERNATIVES[:off]
    picks = [(t, s) for t, s in rot if t not in rejected_titles][:2]
    if len(picks) < 2:  # everything rejected: fill from the rotation anyway
        picks += [p for p in rot if p not in picks][:2 - len(picks)]
    return [{"title": t, "style": s} for t, s in picks]


def make_briefs(ctx: dict, rejected: list[dict], round_n: int, session_id=None) -> list[dict]:
    """Exactly 3 {title, style} briefs; look 1 follows the client brief."""
    style1 = (ctx.get("direction") or ctx.get("design_preferences") or "clean and professional")
    style1 = str(style1).strip() or "clean and professional"
    look1 = {"title": "Your brief", "style": style1}
    rej = rejected or []
    titles = {r.get("title") for r in rej if r.get("title")}
    if meta.enabled():
        try:
            simple = [{"title": r.get("title"), "style": r.get("style") or r.get("brief")}
                      for r in rej if r.get("title") or r.get("style") or r.get("brief")]
            prompt = (
                "Suggest 2 alternative design looks as JSON "
                '{"looks":[{"title","style"},{"title","style"}]}. '
                f"Client brief: {json.dumps(ctx)}. "
                f"Current look (must differ): {json.dumps(look1)}. "
                f"Rejected looks (must all differ): {json.dumps(simple)}. "
                "The 2 new styles must differ from each other, from the current look "
                "and from every rejected style. Each title is non-empty, max 40 chars; "
                "each style is a non-empty string.")
            d = meta.chat_json("image_brief", [{"role": "user", "content": prompt}],
                               session_id=session_id)
            looks = (d or {}).get("looks")
            if isinstance(looks, list) and len(looks) == 2 and all(
                    isinstance(x, dict) and isinstance(x.get("title"), str)
                    and isinstance(x.get("style"), str) and x["title"].strip()
                    and x["style"].strip() and len(x["title"].strip()) <= 40 for x in looks):
                return [look1] + [{"title": x["title"].strip(), "style": x["style"].strip()}
                                  for x in looks]
        except Exception:
            pass
    return [look1] + _fallback(titles, round_n)
