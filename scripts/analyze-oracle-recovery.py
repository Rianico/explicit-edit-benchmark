#!/usr/bin/env python3
"""Summarize oracle chains and retain task-level IDE losses for trajectory review."""

import json
import sys
from pathlib import Path

run = Path(sys.argv[1])
summary = json.loads((run / "summary.json").read_text())
rows = summary["results"]
profiles = sorted({row["profile"] for row in rows})
stats = {}
for profile in profiles:
    selected = [row for row in rows if row["profile"] == profile]
    stats[profile] = {
        "tasks": len(selected),
        "firstPassed": sum(
            row.get("recovery", {}).get("firstAttemptPassed", False) for row in selected
        ),
        "eventualPassed": sum(row["passed"] for row in selected),
        "recoveries": sum(
            row.get("recovery", {}).get("recoveriesUsed", 0) for row in selected
        ),
        "totalSeconds": sum(row.get("seconds", 0) for row in selected),
        "infrastructureFailures": sum("recovery" not in row for row in selected),
    }
losses = []
for ide in (row for row in rows if row["profile"] == "ide"):
    peers = [
        row
        for row in rows
        if row["taskId"] == ide["taskId"] and row["profile"] != "ide"
    ]
    winners = [row["profile"] for row in peers if row["passed"] and not ide["passed"]]
    first_winners = [
        row["profile"]
        for row in peers
        if row.get("recovery", {}).get("firstAttemptPassed")
        and not ide.get("recovery", {}).get("firstAttemptPassed")
    ]
    if winners or first_winners or not ide["passed"]:
        losses.append(
            {
                "taskId": ide["taskId"],
                "eventualWinnersAgainstIde": winners,
                "firstAttemptWinnersAgainstIde": first_winners,
                "ideArtifact": f"trials/{ide['id']}",
                "peerArtifacts": {
                    row["profile"]: f"trials/{row['id']}" for row in peers
                },
            }
        )
output = {"profiles": stats, "ideReviewCases": losses}
(run / "oracle-analysis.json").write_text(json.dumps(output, indent=2) + "\n")
print(json.dumps(output, indent=2))
