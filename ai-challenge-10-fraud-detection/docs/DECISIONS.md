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

**Decision:**
- Flag only when ALL components of a bundle are present on the claim.
- If the bundle code is absent, the components are billed separately instead of the bundle (split billing).
- If the bundle code is present as well, the same services are billed twice. This is also flagged, and the evidence says so.
- The bundle code alone, without all its components, is not flagged.

**Consequence:**
- A "≥ 2 components" threshold would flag every normal visit + blood test. Requiring the full set avoids that.
- Bundle + components is the more serious case, and no other rule catches it: the components are valid procedures for the diagnosis (Decision 7) and the claim is not a duplicate. Leaving it unflagged would make it a silent gap.
- The generator only injects split billing (bundle code absent), so this case does not affect the metrics.

---

## 5. Phantom billing — which claims are flagged

**Context:** A provider averages about 0.1 claims per day, so a provider-day with > 30 claims must be injected. The brief asks for 25 phantom claims, but at least 31 are needed to cross the threshold.

**Decision:** Flag every claim of a provider-day that has > 30 claims.

**Consequence:** The ~6 clean claims on that day are known false positives. They are accepted and reported explicitly.

---

## 6. Weekend anomaly — historical weekend share (refined by Decision 19)

**Context:** If the provider's weekend share includes the injected weekend surgeries, the share rises and the rule misses the very cases that were injected.

**Decision:**
- The provider's weekend share excludes the claim being evaluated.
- The provider must have ≥ 20 surgical claims (Decision 19).
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

**Decision:** Flag when 47,500 ≤ amount < 50,000, i.e. `min_amount` ≤ amount < `auto_approval_threshold`. The thresholds are read from config. The upper bound is the threshold itself rather than `max_amount` (49,999), so an amount with cents such as 49,999.50 is flagged. `max_amount` is only the highest amount the generator injects.

**Consequence:** The boundaries are explicit and testable, and can be changed without code changes. Amounts that are not whole numbers cannot slip between 49,999 and 50,000.

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

---

## 19. Weekend anomaly — the share is over surgical claims

**Context:** Decision 6 says "the provider's weekend share" without saying over which claims. The first implementation used all of the provider's claims. Decisions 14 and 17 already reason in surgical claims (≥ 30 surgical claims, 1/29 ≈ 3.4%, "fewer than 20 surgical claims"), and weekend consultations or suturing at a hospital say nothing about whether it operates on weekends.

**Decision:**
- Share = weekend surgical claims / surgical claims of the provider, with the evaluated claim removed from both counts. It is a weekend surgical claim itself, so it is subtracted from the numerator and the denominator.
- Example: a provider with 40 surgical claims, 2 of them on Sundays: each of the two is evaluated against 1/39 ≈ 2.6%.
- `min_provider_claims` counts the provider's surgical claims, the evaluated one included. 20 surgical claims are evaluated (against 19 others); 19 are not.
- A claim is surgical as defined in Decision 14 (bundle components count).
- Non-surgical claims, weekend or not, are in neither count.

**Consequence:**
- Weekend consultations at a provider do not mask weekend surgery. A provider with 100 routine claims but 5 surgeries is not evaluated.
- The brief's "historical weekend volume" is read as weekend surgical volume.
- On the generated data the rule flags exactly the 20 injected weekend cases and nothing else.

---

## 20. Score normalization and priority bands

**Context:** The brief asks for a "weighted sum of triggered rules, normalized to 0–100" without saying what to normalize by.
- Dividing by the sum of all 8 weights (27) puts a confirmed duplicate at 19 and no real claim near 100.
- Dividing by the highest raw sum in the dataset makes a claim's score depend on the other claims, so it changes between runs.

**Decision:**
- raw = sum of the severities of the claim's flags (each severity is the rule's weight from config).
- risk_score = round(100 × (1 − e^(−raw / saturation))), with `saturation` = 4 in `config/thresholds.json`.
- A claim with at least one flag scores at least 1, so "score > 0" always means "a rule fired" (Decision 9), whatever the saturation.
- Priority: High ≥ 70, Medium 50–69, Low 1–49; a score of 0 has priority None. The two cut-offs are in config.
- Ranking: score descending, then claim_id ascending.

**Consequence:**
- Single rules score: weight 2 → 39 (Low), 3 → 53 (Medium), 4 → 63 (Medium), 5 → 71 (High). Two weight-2 rules → 63; upcoding + clustering (4 + 2) → 78.
- Each extra flag raises the score by less than the previous one; 100 needs raw ≥ 22.
- A claim's score depends only on its own flags and the config, so it is the same on any dataset.
- Patterns detected only by weight-2 rules are Low priority but still flagged (Decision 9).

---

## 21. Clean data stays as designed; perfect recall comes from how the data is built

**Context:** Recall is 100% for every pattern on both seed 42 and seed 7, and 6 of the 8 rules never fire on a clean claim. An audit of the generated data (now `npm run inspect`) found why:
- The clean data lacks two kinds of natural noise, by Decisions 12 and 18:
  - 0 clean claim pairs with the same member + diagnosis 1–7 days apart. With the same claims and dates placed at random, about 8 such pairs appear (4–17 over 200 shuffles).
  - 0 clean amounts in 47,500–49,999, although 370 clean claims are ≥ 40,000. On K35.80 [P-1008, B-9002] this leaves a visible gap: 17 clean claims in 45,000–47,499, none in the band, 14 in 50,000–52,499.
- Fraudulent claims carry tells that no rule uses:
  - Every dx_procedure_mismatch claim (20/20) and every unbundling claim (25/25) has a diagnosis + procedure combination that no clean claim has. Unbundling combinations are also too small for upcoding, which accounts for all 25 upcoding skips.
  - No upcoded or mismatch amount is a multiple of 100 (0 of 50, against 9.9% of clean claims; about 0.5% by chance).
  - Fraudulent claims are more often inpatient (37% vs 25%) and on weekends (16.5% vs 7.5%). This comes from the weekend and clustering patterns themselves.
  - Mean claim_id rank is 917 for fraud and 1,010 for clean claims (1,000.5 if uninformative), mainly because the 31 phantom claims share one date and so have consecutive IDs.
- Upcoding recall is fixed at generation time. `verify.ts` computes the same statistic as the rule, a leave-one-out mean and sample SD over the same procedure-code combination with the same `min_other_claims` from config. The rule computes it in O(1) from group sums, `verify.ts` with `leaveOneOutStats` from `stats.ts`, and the upcoding tests check that the two agree. The generator rejects any dataset in which an upcoded claim has z < 2.5, above the rule's `z_threshold` of 2. It also rejects any clustering claim with z above `z_threshold`, so clustering never fires upcoding.

**Decision:**
- Keep Decisions 12 and 18. Do not add noise to clean claims.
- The data is synthetic. The README will say that 100% recall is a consequence of how the data is built, not evidence of detection performance on real claims.
- `npm run inspect` prints the tells above on any dataset, under the heading "Known tells of the synthetic data (not used by any rule)". It reads labels.csv, but it is a diagnostic only: nothing it computes reaches the rules or the score.

**Consequence:**
- Per-pattern recall only shows that each rule implements its own definition on cases built to match it. For upcoding it is guaranteed by the generator's check.
- The only natural noise the engine meets is upcoding on clean claims (46 on seed 42, 42 on seed 7; 3.5% of clean claims exceed 2 SD) and the clean claims on the phantom day (6 and 7, Decision 5). FPR (2.9% and 2.7%) is therefore an optimistic estimate.
- A model trained on this data could separate fraud by the unseen-combination and amount-rounding tells. The rules do not use them, and they are not a reason to trust the results.
