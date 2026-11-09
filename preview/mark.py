#!/usr/bin/env python3
"""Marks a collected copy of the site as a pull request's preview.

    python3 preview/mark.py _site --url https://pr-7-colourio-preview.mwarkentin.workers.dev \
        --pr 7 --sha 0123abc --pr-url https://github.com/mwarkentin/colourio/pull/7

In index.html it:
- swaps the live site's address in the link-preview tags for the preview's,
- starts the <title> with "PR <number> · ",
- asks search engines not to index it, and
- adds a strip across the top naming the pull request and commit, linked to
  the pull request.

Telemetry and analytics already stay off, since they only run on the live
site's hostname.
"""

import argparse
import html
import pathlib
import sys

LIVE = "https://mwarkentin.github.io/colourio/"

BANNER = (
    '<a href="{pr_url}" style="display:block;padding:6px 16px;background:#ffe066;color:#1a1a1a;'
    'font:600 13px/1.4 system-ui,sans-serif;text-align:center;text-decoration:none">'
    "Preview of pull request #{pr} at {sha}</a>"
)


def mark(page: str, url: str, pr: str, sha: str, pr_url: str) -> str:
    def replace_once(old: str, new: str, text: str) -> str:
        if text.count(old) != 1:
            sys.exit(f"mark.py: expected one {old!r} in index.html, found {text.count(old)}")
        return text.replace(old, new)

    if 'name="robots"' in page:
        sys.exit("mark.py: index.html is already marked as a preview; collect a fresh copy of the site first")

    page = page.replace(LIVE, url.rstrip("/") + "/")
    page = replace_once("<title>", f"<title>PR {html.escape(pr)} · ", page)
    page = replace_once("</head>", '    <meta name="robots" content="noindex">\n    </head>', page)
    banner = BANNER.format(pr_url=html.escape(pr_url, quote=True), pr=html.escape(pr), sha=html.escape(sha[:7]))
    return replace_once("<body>", "<body>\n        " + banner, page)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("site", type=pathlib.Path)
    parser.add_argument("--url", required=True)
    parser.add_argument("--pr", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--pr-url", required=True)
    args = parser.parse_args()

    index = args.site / "index.html"
    index.write_text(mark(index.read_text(encoding="utf-8"), args.url, args.pr, args.sha, args.pr_url), encoding="utf-8")


if __name__ == "__main__":
    main()
