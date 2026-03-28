# HSA FORENSIC AUDIT — COMPLETE FINDINGS

## SECTION 1 — CURRENT ARCHITECTURE MAP

```
TRUTH DECIDED IN:                    PROBLEM:

api/generate-hsa.ts (2000+ lines)    MONOLITH — inlines duplicate copies of:
  └ HSA_SYSTEM_PROMPT (~100 lines)     - OddsSnapshot type
  └ classifyOddsRow()                  - summarizeOdds() (400 lines)
  └ summarizeOdds()                    - mode() function
  └ computeBookCoordination()          - BookLine types
  └ buildHsaUserMessage()              - postProcessBookNames()
  └ postProcessBookNames()           ALL duplicated from api/lib/odds-summarizer.ts
  └ confidence directive (inline)
  └ MLB truth layer call
  └ lifecycle engine call
  └ NHL classifier call

supabase/functions/detect-rlm/       SEPARATE ENGINE — shares NO code with above
  └ index.ts (1300+ lines)             - own thresholds
  └ heard-alert.ts                     - own signal taxonomy
                                       - own confidence scoring
                                       - own output format

api/lib/signal-engine/               THIRD ENGINE — also shares NO code
  └ classify/signal-classifier.ts      - yet another set of thresholds
  └ score/confidence-scorer.ts         - yet another confidence system
  └ config/league-thresholds.ts        - partially overlaps detect-rlm

api/lib/market-lifecycle-engine.ts   FOURTH engine — lifecycle phases
  └ own thresholds (LEAGUE_MARKET_THRESHOLDS)
  └ own config system
  └ does NOT share with signal-engine or detect-rlm

api/lib/mlb-truth-layer/             MLB-only — fifth system
  └ own signal tags
  └ own thresholds
  └ own confidence rules

api/lib/nhl-signal-classifier.ts     NHL-only — sixth system
  └ own rules
  └ called from generate-hsa only
```

### VERDICT: SIX separate signal/threshold systems that don't share code.

---

## SECTION 2 — BAND-AID / TECH DEBT FINDINGS

| # | File | Issue | Risk |
|---|------|-------|------|
| 1 | generate-hsa.ts:167-175 | MLB ±1.5 spread normalization inlined. Same logic also in mlb-truth-layer/normalize.ts | HIGH |
| 2 | generate-hsa.ts:1645-1700 | Confidence directive computed INLINE with hardcoded thresholds (MLB: 20/10/5, spread: 2/1/0.5). Not from signal engine. | CRITICAL |
| 3 | generate-hsa.ts:1300-1315 | Clean snapshot construction uses `spreadClassified.line` — band-aid from MLB run line fix | MEDIUM |
| 4 | generate-hsa.ts:1120-1167 | Cache logic parses narrative TEXT with regex to check if lines moved — fragile | HIGH |
| 5 | generate-hsa.ts:817-863 | postProcessBookNames injects text after section headers — fragile regex-based post-processing | HIGH |
| 6 | generate-hsa.ts:1790-1805 | Market lean fix uses regex to detect wrong team/spread pairing in Claude output | MEDIUM |
| 7 | detect-rlm/index.ts:442-495 | evaluateSpreadSignal/evaluateMLSignal/evaluateTotalSignal — three functions with near-identical structure, only thresholds differ | MEDIUM |
| 8 | detect-rlm/index.ts:88-92 | `seenRows` query hits odds_snapshots (the table that times out) | CRITICAL |
| 9 | detect-rlm/index.ts:734-788 | deriveOverall classification cascade uses magic numbers (>=6, >=5, >=4, >=3, >=2) instead of named constants | MEDIUM |
| 10 | signal-engine/config/league-thresholds.ts | Thresholds here are DIFFERENT from the ones in market-lifecycle-engine.ts for the SAME sports | CRITICAL |
| 11 | generate-hsa.ts:9-172 | 172-line HSA_SYSTEM_PROMPT string literal inlined in the handler file | HIGH |
| 12 | useGamesFeed.ts:7-70 | deriveSideConfidence / deriveTotalConfidence — YET ANOTHER confidence computation, different from all backend systems | CRITICAL |
| 13 | generate-hsa.ts:396-404 | BOOK_DISPLAY_NAMES map — duplicated in heard-alert.ts, mlb-truth-layer, etc. | LOW |

---

## SECTION 3 — CROSS-SPORT LOGIC VIOLATIONS

| # | Location | Violation |
|---|----------|-----------|
| 1 | generate-hsa.ts:376-385 | `summarizeOdds()` treats ALL sports the same for spread consensus, timeline, steam detection. NBA's 1-point move and MLB's 1-point total move are weighted identically. |
| 2 | generate-hsa.ts:468-478 | Steam detection: `diff >= 1 && timeDiff <= 30` — same threshold for NBA spreads, NHL puck lines, MLB run lines, and totals in every sport |
| 3 | detect-rlm/index.ts:107-112 | Thresholds branch on `isMLPrimary` (NHL/MLB) vs not. But NHL and MLB are treated IDENTICALLY despite being completely different sports. |
| 4 | signal-classifier.ts:244-284 | `checkSteam()` uses the same function for all sports — only the thresholds differ. The LOGIC should differ (NHL puck line steam ≠ NBA spread steam). |
| 5 | confidence-scorer.ts:30-204 | `scoreSignal()` applies identical scoring LOGIC across all sports. The weights are the same. Only thresholds from league-config differ. |
| 6 | generate-hsa.ts:1001-1083 | `buildHsaUserMessage()` constructs the prompt identically for all sports except a small MLB section. NHL gets no special treatment in the prompt data. |
| 7 | market-lifecycle-engine.ts | Uses same lifecycle states (QUIET → INITIATION → STEAM → etc.) for all sports. MLB moneyline lifecycle ≠ NBA spread lifecycle. |

---

## SECTION 4 — CURRENT-STATE TRUTH FAILURES

| # | Location | Failure |
|---|----------|---------|
| 1 | generate-hsa.ts:376-530 | `summarizeOdds()` computes spread/total/ML movement from FIRST snapshot to LAST snapshot. If a line moved then reverted, the delta shows 0 — missing the reversal story. |
| 2 | detect-rlm/index.ts:250-300 | `buildGameFacts()` takes only FIRST and LAST snapshot per book. All intermediate movement is invisible. A steam move that retraced is undetectable. |
| 3 | market-lifecycle-engine.ts | Has lifecycle states including REVERSAL — but this is ONLY used if generate-hsa imports it, and it's wrapped in try/catch as "non-fatal" (line 1356-1368). If it crashes, stale data is used. |
| 4 | generate-hsa.ts:1120-1167 | Cache invalidation checks if the line moved ≥1.0 by PARSING THE NARRATIVE TEXT. If Claude didn't mention the exact number, the check fails and stale analysis is served. |
| 5 | detect-rlm/index.ts:442-495 | Signal evaluation only sees open→current delta. A spread that went -5→-3→-5 shows as "0 movement" = NONE signal. |

---

## SECTION 5 — CLEAN REWRITE ARCHITECTURE

```
src/sport-registry/
  ├── types.ts           — Universal sport config interface
  ├── nba.ts             — NBA thresholds, rules, narrative constraints
  ├── ncaab.ts           — NCAAB (shares base with NBA, overrides differences)
  ├── nhl.ts             — NHL-specific (puck line, ML-primary, state flips)
  ├── mlb.ts             — MLB-specific (ML-primary, ±1.5 run line, truth layer)
  ├── nfl.ts             — NFL placeholder
  ├── template.ts        — Future sport template

src/core/
  ├── data-normalizer.ts — Raw snapshots → normalized market data
  ├── true-open-engine/  — (already built) Universal open detection
  ├── current-state.ts   — Current consensus from latest_odds
  ├── orchestrator.ts    — Routes to sport module, assembles output
  ├── renderer.ts        — Converts signal output → narrative text

SHARED CORE may:
  - normalize data
  - compute true opens
  - assemble snapshots
  - route to sport modules
  - render narrative from structured output

SHARED CORE may NOT:
  - decide thresholds
  - classify signals
  - score confidence
  - determine if a move is meaningful
  - decide what "steam" means for a sport
```

---

## SECTION 6 — SPORT-SPECIFIC LOGIC REQUIREMENTS

### NBA
- Spread: meaningful ≥1.0pt, steam ≥1.5pt in ≤30min
- Total: meaningful ≥1.5pt, steam ≥2.0pt
- ML: meaningful ≥15c, steam ≥25c
- Key numbers: 3, 4, 5, 7, 10
- Primary market: spread
- Full-book consensus: 4+ books

### NCAAB
- Same base as NBA but:
  - ML thresholds higher (≥20c meaningful) — wider ML variance
  - Key numbers: 3, 7, 10
  - Less reliable public splits data

### NHL
- Spread: puck line ±1.5 is structural (like MLB run line)
  - Sign differences are STATE FLIPS, not point moves
  - meaningful move = puck line flip WITH ML confirmation
- ML: meaningful ≥10c, steam ≥20c
- Total: meaningful ≥0.5 goal, key numbers 5.5, 6, 6.5
- Primary market: MONEYLINE
- Signal priority: ML > public divergence > coordination > puck line

### MLB
- Run line: structurally ±1.5, normalize to absolute value
  - line_changed vs price_changed distinction
  - Sign differences are NOT movement
- ML: meaningful ≥8c, steam ≥20c
  - Favorite strengthening vs dog buyback are distinct signals
- Total: meaningful ≥0.5 run, key numbers 7.5, 8, 8.5, 9
- Primary market: MONEYLINE
- Pitcher status affects confidence

---

## SECTION 7 — SIGNAL LIFECYCLE MODEL

```
FORMING → ACTIVE → CONFIRMED → DECAYING → EXPIRED
                                    ↓
                              INVALIDATED

FORMING:
  - First book moves
  - No confirmation yet
  - Cannot be shown as ACTIVE

ACTIVE:
  - 2+ books confirmed direction
  - Current market still reflects the move
  - Time window met

CONFIRMED:
  - 3+ books moved
  - Market persisted (held across 2+ snapshots)
  - Sharp book participated

DECAYING:
  - Move happened but current market is partially reverting
  - Confidence should decrease
  - Should NOT show as fresh steam

EXPIRED:
  - Move fully retraced
  - No longer visible in current market
  - MUST NOT show as active signal

INVALIDATED:
  - Contradicted by opposing evidence
  - Multiple books reversed
  - Current state opposite to signal direction
```

### Critical rule: historical move + current reversion = EXPIRED, not ACTIVE.

---

## SECTION 8 — CONFIDENCE SYSTEM REWRITE

Current problem: confidence is computed in 6 different places with different logic.

Fix: ONE confidence function, parameterized by sport config.

```
confidence = f(
  move_size / sport_threshold,           // normalized magnitude
  books_moved / total_books,             // coordination rate
  sharp_book_weight,                     // Pinnacle bonus
  time_within_window,                    // velocity bonus
  cross_market_confirmation,             // ML confirms spread
  public_divergence,                     // RLM bonus
  -reversal_penalty,                     // current state check
  -stale_penalty,                        // age penalty
  -incomplete_board_penalty,             // few books
  -contradiction_penalty                 // markets disagree
)
```

---

## SECTION 9 — NO-SIGNAL / WATCH RULES

HSA must return NO SIGNAL when:
- No market moved beyond sport-specific meaningful threshold
- All books held their lines
- Movement was noise (sub-threshold)

HSA must return WATCH when:
- One market moved but others contradict
- Move is forming (1-2 books only)
- Sharp divergence exists but no line movement confirms it
- Historical move partially retraced

HSA must NEVER:
- Force a side when no edge exists
- Show "Moderate" or "High" confidence with sub-threshold movement
- Present a reverted move as active

---

## SECTION 10 — IMPLEMENTATION PLAN

### Phase 1: Stop the bleeding (1-2 days)
- Delete inline summarizeOdds() from generate-hsa.ts — use single source
- Centralize ALL thresholds into league-thresholds.ts (merge lifecycle engine thresholds)
- Add current-state validation: signal must exist in current market
- Fix detect-rlm to query latest_odds instead of odds_snapshots
Files: generate-hsa.ts, league-thresholds.ts, detect-rlm/index.ts

### Phase 2: Sport modules (3-5 days)
- Create sport-registry/ with nba.ts, ncaab.ts, nhl.ts, mlb.ts
- Move ALL sport-specific thresholds, rules, and signal priority into modules
- Rewrite confidence as single parameterized function
- Add signal lifecycle states
Files: new sport-registry/, signal-classifier.ts, confidence-scorer.ts

### Phase 3: Narrative + testing (2-3 days)
- Move HSA_SYSTEM_PROMPT to separate file
- Narrative renderer only describes validated active signals
- Add per-sport test fixtures (all 12 scenarios per sport)
- Add future sport template
Files: hsa-prompt.ts, narrative-renderer.ts, test fixtures

---

## SECTION 11 — TESTING MATRIX

| Scenario | NBA | NCAAB | NHL | MLB |
|----------|-----|-------|-----|-----|
| Active steam | spread 1.5pt 3 books 20min | spread 1.5pt 3 books 20min | ML 20c 3 books 15min | ML 20c 4 books 60min |
| Fake steam | 1 book moved, others held | 1 book moved | 1 book puck line flip | 1 book ML move |
| Stale flip | spread flip 4h ago, reverted | same | puck line flip reverted | ML move reverted |
| Current reversion | -5.5→-4→-5.5 | same | -1.5→+1.5→-1.5 | +150→+120→+150 |
| Split books | 3 at -4.5, 2 at -5.5 | same | 2 at -1.5, 2 at +1.5 (structural) | sign diff is NOT split |
| Sharp lone move | Pinnacle only | same | Pinnacle ML only | Pinnacle ML only |
| Public vs money | 65% public, money opposite | same | same | same |
| Total-only signal | total moved, spread flat | same | total 0.5 at key number | total 0.5+ |
| ML-only signal | N/A (spread primary) | N/A | ML 15c, puck line flat | ML 10c+, RL flat |
| No-signal board | all flat 4h+ | same | all flat | all flat |
| Late buyback | -6→-5→-6 in last hour | same | +130→+115→+130 | same |
| Conflicting markets | spread toward A, ML toward B | same | ML toward A, total toward B | same |

---

## SECTION 12 — FINAL VERDICT

### Must be deleted immediately:
- Inline `summarizeOdds()` in generate-hsa.ts (400 lines — use single source)
- Inline `mode()`, `toBookLine()`, `BookLine` type dups in generate-hsa.ts
- Regex-based cache invalidation (parse narrative text for numbers)
- detect-rlm query to `odds_snapshots` (table is dead)

### Can be salvaged:
- `api/lib/signal-engine/` — good structure, needs sport isolation
- `api/lib/true-open-engine/` — already sport-agnostic, ready
- `api/lib/mlb-truth-layer/` — correct approach, needs to become the template for all sports
- `market-lifecycle-engine.ts` — good lifecycle concept, needs integration

### Must be rewritten from scratch:
- Confidence computation (currently in 6 places)
- `detect-rlm/index.ts` signal detection (shares no code with HSA engine)
- HSA prompt (move to separate file, parameterize by sport)
- Cache logic (use snapshot_id, not regex text parsing)

### Can current HSA be trusted?
**NO.** It can:
- Show reverted moves as active steam
- Apply basketball thresholds to baseball
- Compute different confidence on dashboard vs HSA modal
- Miss true openers and tell false market stories
- Force a signal when none exists

The architecture works for a demo. It does not work for production market intelligence.

---

## REWRITE RECOMMENDATION SUMMARY

1. **Phase 1 is urgent** — centralize thresholds, add current-state validation, fix detect-rlm data source
2. **Phase 2 is the real fix** — sport modules that own their own rules
3. **Phase 3 makes it trustworthy** — lifecycle states + proper testing

## FIRST FILES TO OPEN
1. `api/lib/signal-engine/config/league-thresholds.ts` — merge with lifecycle engine thresholds
2. `api/generate-hsa.ts` — delete inline summarizer, use single source
3. `supabase/functions/detect-rlm/index.ts` — fix data source, align with signal engine

## SINGLE HIGHEST-RISK BUG
**detect-rlm/index.ts line 88-92**: queries `odds_snapshots` (the table that causes Supabase to time out). Every 10-minute cron run hits this dead table. When it times out, no signals are detected for any game. This is why the dashboard often shows no signals even when markets are moving.
