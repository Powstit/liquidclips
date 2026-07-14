# 11 · Anthropic Brain

Reasoning layer. Reads facts from 07 + 08 + 10, business intent from 00–04, ledger from 09. Answers questions with citations, confidence, and business consequence.

Populated at P7 as a Claude skill: `.claude/skills/liquid-clips-system-brain/SKILL.md`.

## Commands (skill)

| Command | Purpose |
|---|---|
| `/brain scan` | Rebuild `07 Code Graph` and `graph/*.json` |
| `/brain feature <name>` | Explain one feature: purpose · journey · implementation · dependencies · consumers · events · tests · open bugs · blast radius |
| `/brain impact <file-or-symbol>` | What changing this affects (downstream) |
| `/brain journey <journey-id>` | Full front → back → provider → file → HQ chain |
| `/brain verify` | Detect drift, orphan nodes, missing tests, duplicated sources of truth, undocumented CTAs |
| `/brain update` | Regenerate machine-derived files after accepted code changes |
| `/brain doctor` | Run 13 Doctor Mode |
| `/brain explain <bug-id>` | Full root cause + business consequence + confidence + closure gate |

## Rules

- **Every answer cites file:line or graph edge.** No ungrounded prose.
- **Every answer includes confidence.** Never claim 1.00 unless AST-verified.
- **When it can't prove an answer, it says "I don't know."** Proof 10 gates this discipline.
- **Never overwrites human-authored intent (00–04).** Only reads it.
- **Never closes a bug.** DECISION-0004.

## Rendering constraints

- Every answer starts with a citation block: `Sources: [file:line, edge.id, journey.id, ...]`
- Every answer ends with a confidence block: `Confidence: <0.00-1.00> because <reason>`
- If asked a business-consequence question, answer must climb via `04 → 03 → 02 → 00C Mission`.
- If asked a technical question, answer must descend via `04 → 05 → 07`.
