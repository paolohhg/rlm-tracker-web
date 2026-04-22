# Threshold Calibration Notes — post-centMove fix

Context: raw American-odds subtraction produced phantom magnitudes that
inflated cent deltas across the ±100 boundary. Thresholds across the codebase
were tuned against those inflated numbers. After the cent-line fix in branch
`claude/centline-fix-tier1`, thresholds now compare against real cent
magnitudes. Some thresholds will under-fire until recalibrated.

This document is a triage input for a separate calibration brief — not a fix
plan. Fix brief explicitly prohibited threshold changes; all values below
remain at their pre-fix numbers.

## Thresholds affected — categorized by risk

### WILL_BREAK — signal may stop firing in realistic scenarios

**File:** supabase/functions/detect-rlm/heard-alert.ts:152 (MLB_ML_THRESHOLDS.UNDERDOG_MIN_CENTS)
**Threshold:** `80` cents — gates whether the ML move qualifies as a HEARD_ALERT_MLB when the sharp side is the underdog.
**Why it breaks:** Pre-fix, `avgDelta` was computed as `|avg(currML) - avg(openML)|` across books. Averaging American odds before subtracting (a) was invalid in general and (b) could inflate cross-sign moves to 200+ cents. An 80-cent gate was crossable by almost any uniform sign-flip even without true consensus. Post-fix, `avgDelta` is `|avg(centMove(open, curr))|` per book — realistic MLB ML sign-flip consensus across 4+ books typically sits in the 15-40 cent range. 80 is now almost certainly too high.
**Recommendation:** needs empirical data from production replay; initial guess 25-40.

**File:** supabase/functions/detect-rlm/heard-alert.ts:153 (MLB_ML_THRESHOLDS.FAVORITE_MIN_CENTS)
**Threshold:** `60` cents — gates HEARD_ALERT_MLB when sharp side is the favorite.
**Why it breaks:** Same root cause as UNDERDOG_MIN_CENTS. Favorite-side moves typically stay same-sign (-180 → -200, etc.), so pre-fix arithmetic was often accidentally correct here. But the value 60 was calibrated against a mix that included cross-sign inflation. 60 cents in true consensus math is a very large favorite-side move.
**Recommendation:** needs empirical data; initial guess 20-30.

**File:** supabase/functions/detect-rlm/heard-alert.ts:172 (NHL_ML_THRESHOLDS.UNDERDOG_MIN_CENTS)
**Threshold:** `70` cents.
**Why it breaks:** Same root cause as MLB. NHL ML games cross ±100 frequently (pick'em-level matchups).
**Recommendation:** needs empirical data; initial guess 20-35.

**File:** supabase/functions/detect-rlm/heard-alert.ts:173 (NHL_ML_THRESHOLDS.FAVORITE_MIN_CENTS)
**Threshold:** `50` cents.
**Why it breaks:** Same root cause.
**Recommendation:** needs empirical data; initial guess 15-25.

### PROBABLY_OK — threshold is cent-scale, should hold post-fix

**File:** api/generate-hsa.ts:1784-1787, 1801-1804 (MLB + non-MLB sideConf cascade)
**Threshold:** `>= 20` (High), `>= 10` (Elevated), `>= 5` (Moderate) — applied to `Math.abs(summary.mlHomeMovement)`.
**Why probably OK:** Audit noted these as cent-scale and likely correct post-fix. Band widths (5/10/20) are conservative enough that sign-flip inflation was bounded on one end (usually pushed confidence *up* incorrectly, not suppressed it). Post-fix the High band may rarely trigger for spreads-primary sports; watch for shift toward Moderate/Elevated.

**File:** api/generate-hsa.ts:1048 (per-book MOVED/HELD flag)
**Threshold:** `>= 3` on `Math.abs(homeMove)` or `Math.abs(awayMove)`.
**Why probably OK:** 3 cents is fine-grained enough that sign-flip inflation was rarely the decisive factor. Post-fix, per-book detection continues to fire on genuine 3c+ moves.

**File:** api/generate-hsa.ts:2040 (MLB primary-market selection)
**Threshold:** `mlDelta >= 5` sets primaryMarket='moneyline'.
**Why probably OK:** 5c gate on consensus delta; cent-scale and audit-blessed.

**File:** api/generate-hsa.ts:711-713 (consumes `d.move` threshold in moneyline branch — 3c)
**Threshold:** per-book moneyline `move >= 3` for mover classification.
**Why probably OK:** Same rationale as the per-book MOVED/HELD flag.

**File:** supabase/functions/compute-hsa-score/index.ts:141 (breadth bonus)
**Threshold:** `Math.abs(mlMove) >= 5` for the breadth bonus when spread and ML move same direction.
**Why probably OK:** Audit explicitly marked this as PROBABLY_OK. 5c on true consensus remains a reasonable "breadth confirmation" gate.

**File:** api/lib/mlb-truth-layer/signal.ts:18 (ML band thresholds)
**Threshold:** `ML = { NOTABLE: 5, MEANINGFUL: 10, SIGNIFICANT: 15, STEAM: 20 }`.
**Why probably OK:** Audit noted these as cent-scale and should hold post-fix. Band semantics map cleanly onto true cent deltas.

**File:** api/lib/mlb-truth-layer/signal.ts:20 (JUICE band thresholds)
**Threshold:** `JUICE = { NOTABLE: 5, MEANINGFUL: 10, SIGNIFICANT: 15 }` — applied to run-line and total juice deltas.
**Why probably OK:** Same rationale.

**File:** api/lib/mlb-truth-layer/normalize.ts:150 (run line price_changed flag)
**Threshold:** `Math.abs(rl.favorite_price_delta) >= 5`.
**Why probably OK:** Fine-grained; 5c on true delta is still a meaningful change.

**File:** api/lib/mlb-truth-layer/normalize.ts:191 (juiceShiftOnly gate)
**Threshold:** `|overPriceDelta| >= 5 || |underPriceDelta| >= 5`.
**Why probably OK:** Same rationale; 5c gate is appropriate for total juice shifts.

**File:** api/lib/nhl-signal-classifier.ts:162-163 (mlConfirmsSpreadDirection)
**Threshold:** `mlMove > 5` / `mlMove < -5` to confirm spread direction.
**Why probably OK:** Audit marked ±5 as cent-scale and correct post-fix.

**File:** supabase/functions/detect-rlm/heard-alert.ts:233 (per-book moved gate in deltas map)
**Threshold:** `|centMove(openML, currML)| >= 3`.
**Why probably OK:** Audit confirmed 3c is likely still correct; verify on replay.

### UNKNOWN — needs data

**File:** supabase/functions/detect-rlm/heard-alert.ts:154 (MLB_ML_THRESHOLDS.MAX_WINDOW_MINUTES)
**Threshold:** `120` — time window within which the sharp move must occur.
**What we don't know:** Time-based, not cent-based; unaffected by centMove directly. BUT: if the cent-threshold fix causes the ML cents gate to fire on smaller moves, the alert may fire earlier in the window on moves that previously would have been too small. Interaction with the other thresholds needs empirical review.

**File:** supabase/functions/detect-rlm/heard-alert.ts:156-157 (MIN_PARTICIPATION_RATE, MIN_WEIGHTED_PARTICIPATION)
**Threshold:** `0.70` and `0.75`.
**What we don't know:** These use the `moved` flag whose gate (≥3c) is cent-scale and probably OK. Participation metrics *should* be unaffected. Verify against replay that MLB/NHL participation distributions are preserved.

**File:** supabase/functions/detect-rlm/heard-alert.ts:174 (NHL_ML_THRESHOLDS.MAX_WINDOW_MINUTES)
**Threshold:** `90` minutes. Same concern as MLB.

**File:** supabase/functions/detect-rlm/heard-alert.ts:300 (confidence score formula)
**Formula:** `Math.min(100, 85 + Math.floor(avgDelta / 20))`.
**What we don't know:** This derives confidence from avgDelta. Pre-fix avgDelta was inflated, producing higher confidence scores. Post-fix avgDelta is smaller and realistic, so confidence scores may be lower for the same "real" move. 85-floor is safe; the scaling coefficient (`/ 20`) may need review.

**File:** api/generate-hsa.ts:487 (mlDirection "stable" gate)
**Threshold:** `Math.abs(mlHomeMovement) < 3 && Math.abs(mlAwayMovement) < 3`.
**What we don't know:** 3c is fine-grained; pre-fix inflation rarely affected this gate since "stable" is a narrow band. Probably OK in practice but flagged as UNKNOWN because the `stable` vs `directional` classification feeds multiple narrative paths.

### Out-of-scope thresholds flagged for tier 2 or later

These live in tier 2+ files (signal-engine, market-lifecycle-engine, true-open-engine) and are not fixed in this branch. Included here as a to-do for the tier 2 brief — they will break or need review once those files route through centMove:

- **signal-engine/classify/signal-classifier.ts:460** — `HEARD_ALERT_MIN_MOVE_CENTS = 300`. WILL_BREAK. Audit flagged as highest-impact: a single sign-flip was crossing this gate trivially. Post-fix, 300c is extraordinarily large on the cent-line; will suppress HEARD_ALERT firing nearly always. Likely target 30-60.
- **signal-engine/config/league-thresholds.ts** — all moneyline `meaningful_move`, `steam_move`, `frozen_threshold` values are cent-scale. PROBABLY_OK per audit.
- **true-open-engine/config.ts MATERIAL_MOVE_THRESHOLDS** — moneyline thresholds assumed cent-scale per audit. PROBABLY_OK.
- **market-lifecycle-engine.ts** T.meaningful_move / T.steam_move comparisons on moneyline paths. PROBABLY_OK.
- **src/hooks/useGamesFeed.ts:19-22** — MLB confidence label thresholds (5/10/20). PROBABLY_OK per generate-hsa parallel.

## How to calibrate

1. Take a sample window of production `rlm_alerts` and corresponding pre-fix `heard-alert.ts` runs.
2. Re-replay against the cent-line-fixed code paths to compute what `avgDelta`, `ml.home_delta`, etc. *would* have been.
3. For each WILL_BREAK threshold, find the percentile of true cent magnitudes at which the pre-fix system actually fired.
4. Set the post-fix threshold at that percentile on the true-cent distribution.
5. Spot-check a handful of recent HEARD ALERT payloads to confirm they still fire under the new thresholds.

## References

- Audit: `docs/cent-line-audit-2026-04-21.md`
- Fix branch: `claude/centline-fix-tier1`
- Cent-line primitive: `api/lib/hsa/odds/cent-line.ts`
