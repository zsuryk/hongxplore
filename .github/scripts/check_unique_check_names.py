#!/usr/bin/env python3
"""Fail if two jobs across workflows publish the same check-run name.

A check run's name is the job's `name:` (or its id when `name:` is absent).
Two jobs with the same effective name produce duplicate, contradictory rows
in a PR's checks list and confuse required-status branch rules. Static and
offline: scans .github/workflows/*.yml only.
"""
import sys
from pathlib import Path

WORKFLOWS = Path(__file__).resolve().parents[1] / "workflows"


def iter_jobs(path):
    text = path.read_text()
    in_jobs = False
    job_id = None
    job_indent = None
    name = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        indent = len(line) - len(line.lstrip())
        stripped = line.strip()
        if stripped == "jobs:" and indent == 0:
            in_jobs = True
            continue
        if not in_jobs:
            continue
        if indent == 0:
            if job_id is not None:
                yield job_id, name or job_id
            in_jobs, job_id, name = False, None, None
            continue
        if job_id is None and indent == 2 and stripped.endswith(":"):
            job_id, job_indent, name = stripped[:-1], indent, None
        elif job_id is not None and indent == job_indent and stripped.endswith(":"):
            yield job_id, name or job_id
            job_id, name = stripped[:-1], None
        elif job_id is not None and indent > job_indent and stripped.startswith("name:"):
            name = stripped.split(":", 1)[1].strip().strip("'\"")
    if job_id is not None:
        yield job_id, name or job_id


def main():
    seen = {}
    duplicates = []
    for wf in sorted(WORKFLOWS.glob("*.yml")) + sorted(WORKFLOWS.glob("*.yaml")):
        for job_id, eff_name in iter_jobs(wf):
            label = f"{wf.name}:{job_id}"
            if eff_name in seen:
                duplicates.append((eff_name, seen[eff_name], label))
            else:
                seen[eff_name] = label
    if duplicates:
        for eff_name, first, second in duplicates:
            print(
                f"duplicate check-run name {eff_name!r}: published by both "
                f"'{first}' and '{second}'",
                file=sys.stderr,
            )
        sys.exit(1)
    print("ok: all job check-run names are unique")


if __name__ == "__main__":
    main()
