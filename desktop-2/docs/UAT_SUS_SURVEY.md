# System Usability Scale (SUS) · Post-Session Survey

**Instructions to participant:** For each statement, mark ONE box · 1 = Strongly disagree · 5 = Strongly agree. Answer quickly with your gut — don't overthink.

## The 10 questions (industry-standard SUS · Brooke 1996 · Bangor et al. 2009)

| # | Statement | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|
| 1 | I think that I would like to use Liquid Clips frequently. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 2 | I found Liquid Clips unnecessarily complex. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 3 | I thought Liquid Clips was easy to use. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 4 | I think that I would need the support of a technical person to be able to use Liquid Clips. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 5 | I found the various functions in Liquid Clips were well integrated. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 6 | I thought there was too much inconsistency in Liquid Clips. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 7 | I would imagine that most people would learn to use Liquid Clips very quickly. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 8 | I found Liquid Clips very cumbersome to use. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 9 | I felt very confident using Liquid Clips. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 10 | I needed to learn a lot of things before I could get going with Liquid Clips. | ☐ | ☐ | ☐ | ☐ | ☐ |

---

## Scoring (do NOT show participant)

For each question, extract a 0-4 score:

- **Odd questions (1, 3, 5, 7, 9):** subtract 1 from the response → `score = response - 1`
- **Even questions (2, 4, 6, 8, 10):** subtract the response from 5 → `score = 5 - response`

Sum the 10 scores (range 0-40). Multiply by 2.5. Final SUS score is 0-100.

## Score interpretation (per Bangor et al. 2009 · 3500-study meta-analysis)

| SUS score | Grade | Adjective |
|---|---|---|
| ≥ 84.1 | A+ | Best imaginable |
| 80.8 - 84.0 | A | Excellent |
| 78.9 - 80.7 | A- | Excellent |
| 77.2 - 78.8 | B+ | Good |
| 74.1 - 77.1 | B | Good |
| 72.6 - 74.0 | B- | Good |
| 71.1 - 72.5 | C+ | OK |
| 65.0 - 71.0 | C | OK |
| 62.7 - 64.9 | C- | OK |
| 51.7 - 62.6 | D | Poor |
| < 51.7 | F | Awful |

**Launch gate:** SUS ≥ 68 (30th percentile · "above average") is the industry-standard threshold for "acceptable to ship." Below 68 = don't launch.

---

## Cohort scoring worksheet

| Participant | SUS | Grade | Adjective |
|---|---|---|---|
| P1 | | | |
| P2 | | | |
| P3 | | | |
| P4 | | | |
| P5 | | | |
| **Mean** | | | |

Ship-gate result: mean ≥ 68? YES / NO

---

## Individual-question analysis

For any question where the mean response strays from "positive":
- Q1, 3, 5, 7, 9 mean < 3.5 → problem area
- Q2, 4, 6, 8, 10 mean > 2.5 → problem area

Log the problem areas as P0/P1 findings in UAT_ANALYSIS_TEMPLATE.md.
