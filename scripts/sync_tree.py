#!/usr/bin/env python3
import json
import re
import sys
import urllib.request
from pathlib import Path

SOURCE_OWNER = "D3fD3c0y"
SOURCE_REPO = "Free-online-security-services"
SOURCE_BRANCH = "master"
SOURCE_README_RAW_URL = (
    f"https://raw.githubusercontent.com/{SOURCE_OWNER}/{SOURCE_REPO}/{SOURCE_BRANCH}/README.md"
)

OUTPUT_PATH = Path("data/tree.json")

ROOT_NAME = "Free Online Security Services"
ROOT_DESCRIPTION = (
    "Defensive-only curated tree generated automatically from the "
    "D3fD3c0y/Free-online-security-services repository. "
    "Some explicitly offensive or malware-download categories from the source are intentionally excluded."
)
SOURCE_URL = f"https://github.com/{SOURCE_OWNER}/{SOURCE_REPO}"

# Categories intentionally excluded from the generated framework
EXCLUDED_CATEGORIES = {
    "Download Malwares Samples",
    "LoLBaS Projects",
    "Reconnaissance",
    "Social Media",
    "Vulnerabilities",
    "Windows built-in feature to use for offensive",
}

CATEGORY_RENAMES = {
    "Documentation referencing": "Documentation Referencing",
    "Encoder Decoder": "Encoder / Decoder",
    "Signature (Sigma/Yara)": "Signature (Sigma / YARA)",
    "URL/IP/Domain analysis": "URL / IP / Domain Analysis",
    "URL IP Domain analysis": "URL / IP / Domain Analysis",
}

LINK_RE = re.compile(r"\[([^\]]+)\]\(([^)]+)\)")
HEADING_RE = re.compile(r"^##\s+(.*\S)\s*$")
PIPE_SEPARATOR_RE = re.compile(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*$")


def fetch_readme() -> str:
    req = urllib.request.Request(
        SOURCE_README_RAW_URL,
        headers={
            "User-Agent": "online-security-tools-framework-sync/1.0"
        },
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read().decode("utf-8")


def split_md_row(line: str):
    row = line.strip().strip("|")
    return [cell.strip() for cell in row.split("|")]


def normalize_bool(value: str) -> bool:
    if value is None:
        return False
    value = value.strip().lower()
    return value in {"yes", "true", "required", "y"}


def parse_link_cell(cell: str):
    cell = cell.strip()
    match = LINK_RE.search(cell)
    if match:
        return match.group(1).strip(), match.group(2).strip()

    if cell.startswith("http://") or cell.startswith("https://"):
        return cell, cell

    return cell, ""


def normalize_category_name(name: str) -> str:
    name = name.strip()
    return CATEGORY_RENAMES.get(name, name)


def parse_table(headers, rows):
    normalized_headers = [h.strip().lower() for h in headers]

    def idx(*possible_names):
        for candidate in possible_names:
            candidate = candidate.lower()
            if candidate in normalized_headers:
                return normalized_headers.index(candidate)
        return None

    link_idx = idx("link", "name", "tool")
    desc_idx = idx("description", "details")
    account_idx = idx("account required", "account")
    verified_idx = idx("last date verified", "last verified", "verified")

    children = []

    for row in rows:
        if not any(cell.strip() for cell in row):
            continue

        if link_idx is None or link_idx >= len(row):
            continue

        raw_link_cell = row[link_idx]
        name, url = parse_link_cell(raw_link_cell)

        if not name:
            continue

        description = ""
        if desc_idx is not None and desc_idx < len(row):
            description = row[desc_idx].strip()

        requires_account = False
        if account_idx is not None and account_idx < len(row):
            requires_account = normalize_bool(row[account_idx])

        last_verified = ""
        if verified_idx is not None and verified_idx < len(row):
            last_verified = row[verified_idx].strip()

        item = {
            "name": name,
            "type": "link",
            "url": url,
            "description": description,
            "requiresAccount": requires_account,
        }

        if last_verified:
            item["lastVerified"] = last_verified

        children.append(item)

    return children


def parse_markdown_tables(markdown: str):
    lines = markdown.splitlines()
    categories = []

    i = 0
    while i < len(lines):
        heading_match = HEADING_RE.match(lines[i])
        if not heading_match:
            i += 1
            continue

        heading = heading_match.group(1).strip()
        i += 1

        while i < len(lines) and not lines[i].strip():
            i += 1

        if i + 1 >= len(lines):
            continue

        if not lines[i].strip().startswith("|"):
            continue

        if not PIPE_SEPARATOR_RE.match(lines[i + 1]):
            continue

        headers = split_md_row(lines[i])
        i += 2

        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            rows.append(split_md_row(lines[i]))
            i += 1

        normalized_heading = normalize_category_name(heading)

        if normalized_heading in EXCLUDED_CATEGORIES:
            continue

        children = parse_table(headers, rows)
        if not children:
            continue

        categories.append({
            "name": normalized_heading,
            "children": children
        })

    return categories


def build_tree(categories):
    return {
        "name": ROOT_NAME,
        "description": ROOT_DESCRIPTION,
        "sourceName": f"{SOURCE_OWNER}/{SOURCE_REPO}",
        "sourceUrl": SOURCE_URL,
        "children": categories,
    }


def main():
    try:
        markdown = fetch_readme()
    except Exception as exc:
        print(f"ERROR: failed to fetch source README: {exc}", file=sys.stderr)
        sys.exit(1)

    categories = parse_markdown_tables(markdown)

    if not categories:
        print(
            "ERROR: parser produced 0 categories. "
            "The source README format may have changed.",
            file=sys.stderr,
        )
        sys.exit(2)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    tree = build_tree(categories)
    OUTPUT_PATH.write_text(
        json.dumps(tree, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"Wrote {OUTPUT_PATH} with {len(categories)} categories.")


if __name__ == "__main__":
    main()
