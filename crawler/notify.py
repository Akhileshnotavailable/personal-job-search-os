"""Notification drainer: turn pending outbox rows into one digest email.

The app decides *what* is worth telling Sarthak about; this only delivers it. Workers cannot
practically speak SMTP, so delivery happens on the GitHub Actions runner (ADR 007).

One digest per run, never one email per job. A crawl that finds sixteen new roles should produce
one useful message, not sixteen he learns to ignore -- the whole value of the notification is that
it still means something in week six.

Run:
    python -m crawler.notify              # send
    python -m crawler.notify --dry-run    # print the digest, mark nothing
"""

from __future__ import annotations

import argparse
import os
import smtplib
import ssl
import sys
from collections import defaultdict
from email.message import EmailMessage
from email.utils import formatdate
from typing import Any

import httpx
import structlog

log = structlog.get_logger(__name__)

SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))


class NotifyError(RuntimeError):
    pass


def _api() -> tuple[str, dict[str, str]]:
    base = os.environ.get("APP_BASE_URL", "http://localhost:3000").rstrip("/")
    headers = {
        "Authorization": f"Bearer {os.environ.get('INGEST_TOKEN', '')}",
        "Content-Type": "application/json",
    }
    cf_id = os.environ.get("CF_ACCESS_CLIENT_ID")
    cf_secret = os.environ.get("CF_ACCESS_CLIENT_SECRET")
    if cf_id and cf_secret:
        headers["CF-Access-Client-Id"] = cf_id
        headers["CF-Access-Client-Secret"] = cf_secret
    return base, headers


def fetch_outbox() -> dict[str, Any]:
    base, headers = _api()
    r = httpx.get(f"{base}/api/notifications/outbox", headers=headers, timeout=60)
    r.raise_for_status()
    return r.json()


def confirm(
    sent_ids: list[str],
    failed_ids: list[str],
    error: str | None,
    subject: str | None = None,
    body: str | None = None,
    recipient: str | None = None,
) -> None:
    """Confirm delivery, and hand back the email itself so the app can keep a copy.

    The app stores what was queued; only the drainer knows what was actually rendered and sent.
    Passing it back is the difference between "what did the 06:30 email say" being answerable
    and being a reconstruction.
    """
    base, headers = _api()
    r = httpx.post(
        f"{base}/api/notifications/delivered",
        headers=headers,
        json={
            "sent_ids": sent_ids,
            "failed_ids": failed_ids,
            "error": error,
            "subject": subject,
            "body": body,
            "recipient": recipient,
        },
        timeout=60,
    )
    r.raise_for_status()


#: Gmail shows roughly this much of a subject on mobile; past it the company names -- the part
#: worth scanning for -- get cut off.
SUBJECT_BUDGET = 90


def _subject(count: int, company_names: list[str]) -> str:
    """`[APPLY] - Adobe, Swiggy, Razorpay · 8 new design roles`

    Company names lead because that is what makes the email worth opening: "Adobe is hiring" is
    a decision, "8 new matches" is a statistic. They are ordered by best match, so the most
    interesting name survives truncation.
    """
    tail = f" · {count} new design role{'s' if count != 1 else ''}"
    prefix = "[APPLY] - "
    room = SUBJECT_BUDGET - len(prefix) - len(tail)

    shown: list[str] = []
    for name in company_names:
        candidate = ", ".join([*shown, name])
        remaining = len(company_names) - len(shown) - 1
        suffix = f" +{remaining} more" if remaining > 0 else ""
        if shown and len(candidate) + len(suffix) > room:
            break
        shown.append(name)

    listed = ", ".join(shown)
    hidden = len(company_names) - len(shown)
    if hidden > 0:
        listed += f" +{hidden} more"
    return f"{prefix}{listed}{tail}"


def build_digest(notifications: list[dict[str, Any]]) -> tuple[str, str, str]:
    """Return (subject, plain_text, html) for the pending notifications."""
    jobs = [n["job"] for n in notifications if n.get("job")]
    by_company: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for job in jobs:
        by_company[job.get("company") or "Unknown"].append(job)

    # Best match first within a company, and companies with the strongest match first, so the
    # most interesting thing is at the top of the email rather than alphabetically buried.
    for items in by_company.values():
        items.sort(key=lambda j: j.get("match_score") or 0, reverse=True)
    companies = sorted(
        by_company.items(),
        key=lambda kv: max((j.get("match_score") or 0) for j in kv[1]),
        reverse=True,
    )

    count = len(jobs)
    subject = _subject(count, [name for name, _ in companies])

    lines = [f"{count} new matching role{'s' if count != 1 else ''}.", ""]
    for company, items in companies:
        lines.append(f"{company}")
        for j in items:
            loc = f" — {j['location']}" if j.get("location") else ""
            lines.append(f"  [{j.get('match_score', 0)}] {j['title']}{loc}")
            lines.append(f"       {j.get('url', '')}")
            if j.get("match_reason"):
                lines.append(f"       why: {j['match_reason']}")
        lines.append("")
    text = "\n".join(lines)

    def esc(value: Any) -> str:
        return (
            str(value or "")
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
        )

    parts = [
        '<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;'
        'max-width:640px;color:#171717">',
        f"<h2 style='margin:0 0 4px'>{count} new matching role"
        f"{'s' if count != 1 else ''}</h2>",
        "<p style='margin:0 0 20px;color:#666;font-size:14px'>"
        "Product Designer level, in Bangalore, Gurgaon, Remote or Hyderabad.</p>",
    ]
    for company, items in companies:
        parts.append(
            f"<h3 style='margin:20px 0 8px;font-size:15px'>{esc(company)}</h3>"
        )
        for j in items:
            loc = f" · {esc(j['location'])}" if j.get("location") else ""
            parts.append(
                "<div style='padding:10px 12px;border:1px solid #e5e5e5;"
                "border-radius:6px;margin-bottom:8px'>"
                f"<a href='{esc(j.get('url'))}' "
                "style='font-weight:600;color:#171717;text-decoration:none'>"
                f"{esc(j['title'])}</a>"
                f"<div style='color:#666;font-size:13px;margin-top:2px'>"
                f"score {j.get('match_score', 0)}{loc}</div>"
                + (
                    f"<div style='color:#999;font-size:12px;margin-top:4px'>"
                    f"{esc(j.get('match_reason'))}</div>"
                    if j.get("match_reason")
                    else ""
                )
                + "</div>"
            )
    parts.append(
        "<p style='color:#999;font-size:12px;margin-top:24px'>"
        "Sent by Job Search OS after a scheduled crawl. Every match explains itself; "
        "tune the rules in Settings.</p></div>"
    )
    return subject, text, "".join(parts)


def send_email(to: str, subject: str, text: str, html: str) -> None:
    user = os.environ.get("SMTP_USER")
    password = os.environ.get("SMTP_APP_PASSWORD")
    if not user or not password:
        raise NotifyError("SMTP_USER and SMTP_APP_PASSWORD must be set")

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = user
    message["To"] = to
    message["Date"] = formatdate(localtime=True)
    message.set_content(text)
    message.add_alternative(html, subtype="html")

    context = ssl.create_default_context()
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=60) as server:
        server.starttls(context=context)
        server.login(user, password)
        server.send_message(message)


def run(dry_run: bool = False) -> int:
    data = fetch_outbox()
    pending = data.get("notifications") or []
    to = data.get("notify_email")

    if not pending:
        log.info("notify.nothing_pending")
        return 0

    ids = [n["id"] for n in pending]
    subject, text, html = build_digest(pending)

    if dry_run:
        print(f"TO: {to}\nSUBJECT: {subject}\n\n{text}")
        log.info("notify.dry_run", pending=len(ids))
        return 0

    if not to:
        # Deliberately not an error: the queue is fine, the address is simply unconfigured.
        # Failing the run would make every crawl red for a settings gap.
        log.warning("notify.no_recipient", pending=len(ids))
        return 0

    try:
        send_email(to, subject, text, html)
    except Exception as exc:  # noqa: BLE001 - report, then let the next run retry
        log.error("notify.send_failed", error=str(exc)[:300], pending=len(ids))
        confirm([], ids, f"{type(exc).__name__}: {exc}"[:400])
        return 1

    confirm(ids, [], None, subject=subject, body=text, recipient=to)
    log.info("notify.sent", to=to, notifications=len(ids), subject=subject)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Send the pending notification digest.")
    parser.add_argument("--dry-run", action="store_true", help="print instead of sending")
    args = parser.parse_args()

    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.dev.ConsoleRenderer(colors=False),
        ]
    )
    sys.exit(run(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
