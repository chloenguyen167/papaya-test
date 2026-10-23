# Decisions

Interpretation decisions for ambiguous or conflicting parts of [BRIEF.md](BRIEF.md).

---

## 1. Duplicate claim — which claim is flagged

**Context:** The brief defines a duplicate as same member + provider + date + diagnosis, but does not say which claims in a duplicate group are flagged.

**Decision:** Within a duplicate group, the claim with the smallest `claim_id` is the original. Only the later copies are flagged.

**Consequence:** Originals are not flagged. Flagging them would produce 30 false positives.

---

## 2. Rapid re-submission — gap window

**Context:** "Within 7 days" also matches a gap of 0 days, so every duplicate would fire this rule too.

**Decision:** Flag a claim when the gap to the immediately preceding claim with the same member + diagnosis is 1–7 days.

**Consequence:** Same-day repeats are left to the duplicate rule, and the two rules do not overlap.

---

## 3. Upcoding — grouping and statistics

**Context:** A claim has several procedure codes but only one amount, so "mean for that procedure code" cannot be applied per code. Including the claim itself in the mean/SD lets outliers inflate the SD.

**Decision:**
- Group claims by procedure-code combination (codes sorted, then joined).
- Compute mean and SD leave-one-out, excluding the claim being evaluated.
- Skip groups with fewer than 10 claims.

**Consequence:**
- Each claim is compared against claims that bill the same set of procedures.
- A claim cannot mask itself.
- Claims in small groups are not evaluated. The number of skipped claims is reported.

---

## 4. Unbundling — what triggers the rule

**Context:** The brief does not say how many components of a bundle must be present.

**Decision:** Flag only when ALL components of a bundle are present on the claim and the bundle code is absent.

**Consequence:** A "≥ 2 components" threshold would flag every normal visit + blood test. Requiring the full set avoids that.

---

## 5. Phantom billing — which claims are flagged

**Context:** A provider averages about 0.1 claims per day, so a provider-day with > 30 claims must be injected. The brief asks for 25 phantom claims, but at least 31 are needed to cross the threshold.

**Decision:** Flag every claim of a provider-day that has > 30 claims.

**Consequence:** The ~6 clean claims on that day are known false positives. They are accepted and reported explicitly.

---

## 6. Weekend anomaly — historical weekend share

**Context:** If the provider's weekend share includes the injected weekend surgeries, the share rises and the rule misses the very cases that were injected.

**Decision:**
- The provider's weekend share excludes the claim being evaluated.
- The provider must have ≥ 20 claims.
- In the generator, "weekday-only" providers have no clean weekend claims.
- At most 2 cases are injected per provider.

**Consequence:** Injected cases do not dilute their own detection. Providers with too few claims are not evaluated.

---

## 7. Diagnosis–procedure mismatch — unmapped diagnoses

**Context:** The mapping only needs ≥ 10 valid pairs, so many diagnoses may be missing from it.

**Decision:**
- If the diagnosis is not in the mapping, do not flag (missing information is not evidence).
- The valid-procedure list for a diagnosis includes the components of bundles.

**Consequence:** Gaps in the mapping do not produce false positives. Bundle components billed for a mapped diagnosis are not treated as mismatches.

---

## 8. Amount clustering — range

**Context:** The brief says "within 5% below the 50,000 threshold (47,500–49,999)" without fixing the boundaries.

**Decision:** Flag when 47,500 ≤ amount ≤ 49,999. The thresholds are read from config.

**Consequence:** The boundaries are explicit and testable, and can be changed without code changes.

---

## 9. What counts as "flagged" for metrics

**Context:** Precision/recall need a binary prediction, but the output is a 0–100 score.

**Decision:** A claim is flagged when its score > 0 (at least one rule fired). High/Medium/Low priority is a separate concern.

**Consequence:** Patterns detected only by severity-2 rules count toward recall. If only claims scoring ≥ 50 were flagged, those patterns (70/200 claims) would be excluded and the maximum recall would be 65%.

---

## 10. claim_id assignment

**Context:** If fraudulent claims are generated after clean claims and numbered in order, they form a contiguous ID range that reveals the labels.

**Decision:** Assign `claim_id` AFTER shuffling and sorting by date.

**Consequence:** Fraudulent claims do not cluster into an ID range.

---

## 11. Additional metrics and holdout

**Context:** The brief targets recall and FPR only. Data, rules and thresholds are all built on the same dataset.

**Decision:**
- Also report precision and precision@K.
- Run an additional holdout dataset generated with a different seed, without any tuning.

**Consequence:** The report shows the reviewer workload behind the alerts. The holdout run shows whether the results hold on data that was not used for tuning.
