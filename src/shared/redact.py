"""Defense-in-depth: keep share tokens out of logs.

The share API takes the token in the `x-share-token` header and the share page
link carries it in the URL fragment (`/share#t=<token>`), so a plaintext token
never reaches the server inside a path or query string (which uvicorn's access
log would write to uvicorn.log). This filter is the second layer: it rewrites
any share-token-shaped value that still reaches a log record (a legacy
`/share/<token>` hit, a `token=` query value, an echoed header) before the
record is emitted.
"""
import logging
import re

_PATTERNS = [
    # Legacy/fallback path shapes: /api/share/<token> and /share/<token>.
    (re.compile(r"(/api/share/)[A-Za-z0-9\-_~+=/]{8,}"), r"\1[REDACTED]"),
    (re.compile(r"(/share/)[A-Za-z0-9\-_~+=/]{8,}"), r"\1[REDACTED]"),
    # Query/fragment shapes: ?token=<v>, &token=<v>, #t=<v>.
    (re.compile(r"([?&](?:token|share_token)=)[^&\s'\"]+"), r"\1[REDACTED]"),
    (re.compile(r"(#t=)[A-Za-z0-9\-_~+=/]+"), r"\1[REDACTED]"),
]


def redact(text: str) -> str:
    """Return text with share-token-shaped values replaced by [REDACTED]."""
    for rx, sub in _PATTERNS:
        text = rx.sub(sub, text)
    return text


class RedactShareTokenFilter(logging.Filter):
    """Logging filter that scrubs share tokens from the record in place."""

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if record.args:
                msg = record.getMessage()
                scrubbed = redact(msg)
                if scrubbed != msg:
                    record.msg = scrubbed
                    record.args = ()
            elif isinstance(record.msg, str):
                record.msg = redact(record.msg)
        except Exception:
            pass
        return True


_LOGGERS = ("", "onboarding", "uvicorn", "uvicorn.access", "uvicorn.error")
_installed = False


def install() -> None:
    """Attach the filter to the root and server loggers. Idempotent."""
    global _installed
    filt = RedactShareTokenFilter()
    for name in _LOGGERS:
        logger = logging.getLogger(name)
        if not any(isinstance(f, RedactShareTokenFilter) for f in logger.filters):
            logger.addFilter(filt)
    _installed = True
