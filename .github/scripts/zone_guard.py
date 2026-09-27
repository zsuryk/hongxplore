#!/usr/bin/env python3
"""zone-guard — per-path review enforcement (what GitHub's branch checkboxes can't do).

Rule: a PR merges with ZERO approvals iff the author owns every touched path;
any path outside the author's zone needs at least one APPROVED review from that
path's owner(s). This applies to every author, including the repo owner — no
short-circuit.

Escape hatch: a PR conversation comment containing "zone-guard bypass"
(case-insensitive) posted by the repo owner passes unconditionally. Only the
oldest 100 conversation comments are scanned (fail-closed beyond that).

CODEOWNERS is always read from the PR's BASE commit, never the
PR's own copy — otherwise a PR could grant itself ownership.

Supported pattern subset (see §6): '*' catch-all, '/dir/' prefix, '/file' exact.
"""
import json, os, subprocess, sys, urllib.request

BYPASS_PHRASE = "zone-guard bypass"


def gh(path):
    req = urllib.request.Request(
        "https://api.github.com" + path,
        headers={
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def load_rules(base, owner):
    try:
        text = subprocess.check_output(
            ["git", "show", f"{base}:.github/CODEOWNERS"],
            text=True,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        text = "*"  # no CODEOWNERS at base yet -> everything falls to the repo owner
    rules = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = line.split()
        owners = [p.lstrip("@").lower() for p in parts[1:] if p.startswith("@")]
        if owners:
            rules.append((parts[0], owners))
    if not any(p == "*" for p, _ in rules):
        rules.append(("*", [owner]))
    return rules


def matches(pattern, path):
    if pattern == "*":
        return True
    if pattern.startswith("/"):
        p = pattern[1:]
        return path.startswith(p) if p.endswith("/") else path == p
    return path == pattern  # bare pattern: repo-root exact (parser subset)


def owners_of(path, rules, owner):
    owners = None
    for pattern, rule_owners in rules:  # last match wins (CODEOWNERS semantics)
        if matches(pattern, path):
            owners = rule_owners
    return owners or [owner]


def bypassed(owner, repo, pr):
    """Repo owner waives the gate with a conversation comment containing the phrase."""
    try:
        comments = gh(f"/repos/{repo}/issues/{pr}/comments?per_page=100")
    except Exception as exc:  # API trouble: stay strict (fail closed)
        print(f"zone-guard: warning — could not read conversation comments: {exc}")
        return False
    for c in comments:
        login = ((c.get("user") or {}).get("login") or "").lower()
        if login == owner and BYPASS_PHRASE in (c.get("body") or "").lower():
            return True
    return False


def main():
    author = os.environ["PR_AUTHOR"].lower()
    owner = os.environ["REPO_OWNER"].lower()
    rules = load_rules(os.environ["BASE"], owner)
    files = subprocess.check_output(
        ["git", "diff", "--name-only", "--no-renames",
         f"{os.environ['BASE']}...{os.environ['HEAD']}"],
        text=True,
    ).splitlines()
    if not files:
        print("zone-guard: no changed files — pass")
        return 0
    if bypassed(owner, os.environ["REPO"], int(os.environ["PR_NUMBER"])):
        print(f"zone-guard: PASS — '{BYPASS_PHRASE}' comment from {owner}")
        return 0
    reviews = gh(
        f"/repos/{os.environ['REPO']}/pulls/{os.environ['PR_NUMBER']}/reviews?per_page=100"
    )
    approved = {
        (r.get("user") or {}).get("login", "").lower()
        for r in reviews if r["state"] == "APPROVED"
    }
    blocked = {}  # owner-set -> [files] still missing an approval
    for path in files:
        zone_owners = tuple(owners_of(path, rules, owner))
        if author in zone_owners or approved & set(zone_owners):
            continue
        blocked.setdefault(zone_owners, []).append(path)
    if not blocked:
        print("zone-guard: PASS — author owns all touched zones, or owner(s) approved")
        return 0
    print("zone-guard: FAIL — cross-zone change without owner approval:")
    for zone_owners, paths in blocked.items():
        shown = ", ".join(paths[:5]) + (" …" if len(paths) > 5 else "")
        print(f"  - {'/'.join(zone_owners)} must APPROVE: {shown}")
    print("Own-zone changes need no approval. Ask the listed owner(s) to approve this PR.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
