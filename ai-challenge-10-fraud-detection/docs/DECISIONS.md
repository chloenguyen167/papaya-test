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
- Skip groups with fewer than 10 claims (refined by Decision 15).

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
- At most 2 cases are injected per provider (generator constraints refined by Decision 14).

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

---

## 12. Clean amounts avoid the clustering band; clustering only on high-cost combinations (refined by Decision 16)

**Context:**
- Clean inpatient claims land in 47,500–49,999 on their own. About 15% of K35.80 [P-1008, B-9002] claims do, which would make them clustering false positives.
- A clustering amount placed on a cheap combination such as [P-1001] (mean ≈ 810, SD ≈ 120) inflates the leave-one-out SD of every other claim in that group to ≈ 3,500. Upcoded claims in the group then go undetected, and the clustering claim also fires upcoding.

**Decision:**
- The clean-claim generator resamples any amount that falls in 47,500–49,999.
- Clustering fraud is applied only to procedure-code combinations whose clean mean is ≥ 35,000 and clean SD is ≥ 5,000, so that the amount stays within 2 SD and does not also fire upcoding.
- If no combination meets this condition, the generator stops with an error. The condition is not lowered.

**Consequence:**
- Clean claims never fire the clustering rule. This is an assumption of the synthetic data, not a property of real claims, and it is listed as a limitation in the README.
- Cheap groups keep their normal SD, so clustering does not mask upcoding there.
- The condition does not guarantee the whole band stays within 2 SD. See the open item in [PLAN.md](PLAN.md).

---

## 13. Rapid re-submission — how cases are injected

**Context:**
- Shifting a copy backwards would make the clean original the "later" claim. Decision 2 would then flag the original, giving 1 false positive and 1 false negative per pair.
- A copy that lands on a weekend at a weekday-only provider breaks the weekend rule: it raises the provider's weekend share and reveals the label, because clean claims there are never on weekends.
- Clean claims repeated within 1–7 days would fire the rule without being labeled.

**Decision:**
- The fraudulent claim is always the later copy, dated original date + 1..7 days. The original stays clean.
- Applied only to claims without surgical procedures. If the new date is a Saturday or Sunday, a different offset is drawn.
- Clean claims with the same member + provider + procedure codes are at least 8 days apart (superseded by Decision 18, which applies per member + diagnosis regardless of provider).
- Duplicates use the same date (gap 0), so they never fire rapid re-submission (Decision 2).

**Consequence:**
- Every injected pair is caught with its label on the right claim.
- Rapid copies never change a provider's weekend share and never interact with the weekend rule.
- The rule matches on member + diagnosis, which is broader than the spacing constraint. Clean claims with the same member and diagnosis but a different provider or procedure set can still fall within 1–7 days. Such false positives are reported, not removed. (Decision 18 closes this gap for clean claims.)

---

## 14. Weekend anomaly — provider volume and surgical definition

**Context:**
- With Decision 6, a provider with 20 claims and 2 injected weekend cases gives 1/19 ≈ 5.26% when one case is evaluated, so both cases are missed.
- Bundles B-9002 and B-9003 contain surgery, but the bundle codes themselves are not in the surgical category.
- Wound suturing (P-2005) is a normal weekend procedure in emergency care.

**Decision:**
- Each weekday-only surgical provider has ≥ 30 surgical claims and receives at most 2 injected weekend claims.
- Clean claims at these providers never fall on a weekend.
- A claim is surgical if at least one of its codes has category `surgical`, including components of any bundle on the claim.
- P-2005 is moved from `surgical` to `medical`.

**Consequence:**
- With the evaluated claim excluded, at most 1 other weekend claim remains among ≥ 29 claims: 1/29 ≈ 3.4% < 5%. Both injected cases are always caught.
- Bundled appendectomy and cholecystectomy claims count as surgery.
- Weekend suturing claims at 24/7 hospitals are not treated as anomalies.

---

## 15. Upcoding — statistics

**Context:** Decision 3 left two choices open:
- whether the 10-claim minimum is counted before or after excluding the evaluated claim;
- whether to use sample or population SD.

Both choices change the result at the boundary, so a test cannot pin the behavior until they are fixed.

**Decision:**
- Use sample SD (divide by n − 1).
- The minimum of 10 claims counts the claims other than the one being evaluated, so a group needs ≥ 11 claims in total. The config key is `min_other_claims`.
- Boundary tests: 10 other claims are evaluated; 9 are skipped.

**Consequence:**
- Sample SD is the standard estimate from a sample and is slightly more conservative for small groups.
- The minimum refers to the size of the reference set that z is computed against, with no off-by-one ambiguity.

---

## 16. Clustering — which combinations can carry a clustering claim

**Context:** K35.80 [P-1007, B-9002] meets Decision 12 (clean mean ≈ 38,100, SD ≈ 5,250), but its mean + 2 SD is only ≈ 48,600. Clustering amounts from about 48,600 to 49,999 on this combination would also fire upcoding.

**Decision:**
- K35.80 [P-1007, B-9002] is removed from the list of base combinations for clustering.
- A combination can carry clustering claims only if its mean + 2 SD ≥ 50,500, measured on the generated clean data.

**Consequence:**
- Every amount in 47,500–49,999 stays within 2 SD of its group, so clustering claims do not also fire upcoding.
- Based on simulation, the qualifying combinations are K35.80 [P-1008, B-9002], K80.20 [B-9003] and S52.50 [P-1006, P-2004, P-2002].
- The generator checks the leave-one-out z of every clustering claim on the final dataset.

---

## 17. Surgical volume for the weekend rule

**Context:**
- Only 3 of the 15 diagnoses are surgical. With a uniform diagnosis mix, a hospital gets ≈ 13 surgical claims.
- Decision 14 needs ≥ 30 surgical claims at every hospital that receives weekend injections.

**Decision:**
- Surgical diagnoses make up about 25% of clean claims (≈ 450 claims).
- About 80% of these go to 12 scheduled-surgery hospitals, ≈ 30 claims each. These hospitals have no clean weekend claims.
- Every other hospital has a weekend share ≥ 8% or fewer than 20 surgical claims, so it does not fire the weekend rule.

**Consequence:**
- Injected weekend cases are always caught (Decision 14).
- Clean weekend surgery at the other hospitals does not produce false positives.
- The diagnosis mix is weighted toward inpatient surgery more than a real portfolio would be. This is an assumption of the synthetic data.

---

## 18. Rapid re-submission — spacing of clean claims

**Context:** Decision 13 spaced clean claims by member + provider + procedure codes. The rule itself matches on member + diagnosis, so clean claims at different providers could still fall within 1–7 days and fire the rule.

**Decision:** Clean claims with the same member and the same diagnosis are at least 8 days apart, regardless of provider.

**Consequence:**
- Clean claims never fire rapid re-submission against each other.
- This is an assumption of the synthetic data (real members do revisit within a week), and it is listed as a limitation in the README.
