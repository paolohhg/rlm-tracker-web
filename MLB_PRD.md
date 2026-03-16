# RLM Tracker v2 — MLB Expansion
## Master Product Requirements Document
**Version:** 3.0 (Consolidated)
**Owner:** Heard Hospitality Group LLC
**Target:** Opening Day — March 26, 2026
**Status:** Ready for Development

---

## 1. Design Principle

The system does not recommend plays based solely on market movement.

**STEP 1 — Market Signal:** Did the moneyline move? Was it against public money? How many books agreed? Was it a sharp book or square book? What time did it move?

**STEP 2 — Context Confirmation:** Does pitcher analytics support the move? Is the bullpen rested or fatigued? Are key hitters in the lineup? Does weather confirm a totals lean? Is there a narrative that explains it away?

**BOTH CONDITIONS MET → High-Grade Recommendation**

---

## 2. Market Opportunity

- 2,430 regular season games — signal volume 5x NBA/NCAAB
- Moneyline-primary market creates frequent sharp vs. public divergence
- Daily action means inefficiencies reset every morning
- High variance sport rewards systematic edge-finding over 162-game sample
- Market slower to adjust than NBA — 5–10 cent ML moves carry significant signal weight

**ABS System Note (2026):** The Automated Ball-Strike Challenge System eliminates umpire zone tendencies as a betting edge. All umpire-based signal logic removed. Catcher pitch framing value eliminated.

---

## 3. Edge Grade System

Every game receives an Edge Grade (A+ through D). This is the primary output.

### Grade Table

| Grade | Requirements | Action |
|-------|-------------|--------|
| A+ | SYNDICATE + 2+ context confirms | Highest conviction |
| A | Strong RLM + 1 context confirm | Act on signal |
| B+ | RLM + weak context signal | Favorable |
| B | Market signal only, no context | Monitor closely |
| C | Context signal only, no market | Informational |
| D | Noise / stale / conflicting | Fade or ignore |

### Point Scoring

**Base score (market signal tier):**
- SYNDICATE CONFIRMED: 80pts
- DOUBLE ML RLM: 80pts
- ML RLM: 65pts
- STEAM MOVE: 60pts
- BOOK SHADE: 40pts
- WATCH: 20pts

**Bonuses:**
- +15pts per confirmed baseball context signal
- +10pts for overnight/morning move timing
- +10pts if confirmed by sharp book (Pinnacle/Circa)
- +20pts for confirmed SYNDICATE buyback pattern
- +10pts if ML and total moving in tandem (cross-market)

**Penalties:**
- -20pts if HSA finds clear narrative explaining the move

**Grade Thresholds:** A+ = 90+ | A = 75–89 | B+ = 60–74 | B = 45–59 | C = 25–44 | D = under 25

---

## 4. MLB Signal Tiers

MLB uses moneyline movement in cents, not spread points.

| Signal Tier | Trigger | Strength |
|------------|---------|----------|
| SYNDICATE CONFIRMED | Buyback: Move → Reversal → Continuation within 90min | ★★★★★+ |
| DOUBLE ML RLM | ML moves 15+ cents vs. public, 4+ books, no narrative | ★★★★★ |
| ML RLM | ML moves 8+ cents vs. public, 3+ books, no narrative | ★★★★ |
| STEAM MOVE | 3+ books move ML 10+ cents within 20 minutes | ★★★★ |
| STALE LINE | Sharp book diverges 10+ cents from square book | ★★★★ |
| BOOK SHADE | 1–2 books move ML, no consensus | ★★★ |
| RUNLINE DIVERGE | ML moves strongly but runline does not follow | ★★★ |
| WEATHER TOTAL | Total moves 0.5+ runs with confirmed wind event | ★★★ |
| PITCHER ALERT | SP change detected, 2+ books not yet adjusted | ★★★★ |
| FROZEN JUICE | ML price holds but juice shifts 8+ cents, 2+ books | ★★ |
| WATCH | Single book movement, unconfirmed | ★ |
| TRACKING | No signal detected | — |

---

## 5. Five-Layer Intelligence Architecture

### Layer 1 — Market Intelligence Engine (inherited)
Tracks: moneyline_open, moneyline_current, runline_home/away, total_open/current
Derived: moneyline_move (cents), total_move (runs), velocity_score, coordination_score
Flags: rlm_flag, steam_flag, freeze_flag

### Layer 2 — Starting Pitcher Engine
**Metrics:** ERA, xERA, FIP, xFIP, K rate, BB rate, whiff rate, hard hit rate, barrel rate, avg innings last 5 starts, velocity trend

**Regression Score:** ERA − xERA
- >1.5 = overperforming (fade candidate)
- 0–1 = neutral
- <-1 = undervalued (follow candidate)

**Signals:** Pitcher Regression Fade | Pitcher Undervalued Edge | Pitcher Form Surge

### Layer 3 — Bullpen Engine
**Metrics:** pitches_last_24h, pitches_last_48h, innings_last_3_days, closer_used, setup_used, high_leverage_usage, bullpen ERA/FIP

**Fatigue Index:** composite of pitch volume + leverage usage + closer workload

**Signals:** Bullpen Fatigue | Bullpen Rest Advantage | Bullpen Collapse Risk

### Layer 4 — Lineup Engine
**Metrics:** lineup_posted_time, missing_regulars, batting_order_strength, lineup_hand_split
**Splits tracked:** team OPS/K rate/wRC+ vs LHP and RHP

**Signals:** Lineup Downgrade | Lineup Upgrade | Handedness Split Edge

### Layer 5 — Environment Engine
**Weather:** temperature, wind_speed, wind_direction, humidity, precip_probability
**Park:** park_factor_runs, park_factor_home_runs, park_factor_handedness

**Thresholds:**
- Wind >15mph OUT → OVER lean
- Wind >15mph IN → UNDER lean
- Wind >20mph → strong total signal
- Temp <45°F → run suppression
- Coors Field → baseline OVER lean

**Signals:** Weather Over/Under Edge | Park Run Boost/Suppression

---

## 6. Advanced Market Signals

### Stale Line
Sharp book ML differs from square book by 10+ cents (5–15 min window) → best price capture opportunity.

### Movement Timing Weight
| Time Before First Pitch | Signal Strength |
|------------------------|-----------------|
| 6–12 hours | Overnight Sharp (strongest) |
| 2–6 hours | Morning Sharp |
| 1–2 hours | Pre-Game Action |
| 0–60 minutes | Late Action (weakest) |

### Buyback Pattern (SYNDICATE CONFIRMED)
Three-phase: Initial sharp move → Partial reversal → Continuation beyond original level — all within 90 minutes.

### Cross-Market Confirmation
ML and total move simultaneously in confirming direction (e.g., ML toward Yankees + total UNDER = sharps expect low-scoring Yankees win).

---

## 7. Database Schema Changes

### odds_snapshots — add columns
```sql
moneyline_home_open NUMERIC
moneyline_away_open NUMERIC
moneyline_home NUMERIC
moneyline_away NUMERIC
runline_home NUMERIC
runline_away NUMERIC
runline_home_price NUMERIC
runline_away_price NUMERIC
total_under_price NUMERIC
book_type TEXT  -- 'sharp' | 'square'
```

### New table: mlb_game_context
```sql
game_id TEXT
game_time TIMESTAMPTZ
league TEXT DEFAULT 'MLB'
home_team TEXT
away_team TEXT
home_starter TEXT
away_starter TEXT
starter_confirmed BOOLEAN
wind_speed NUMERIC
wind_direction TEXT
temperature NUMERIC
precip_probability NUMERIC
ballpark TEXT
park_factor_runs NUMERIC
home_bullpen_pitches_24h INTEGER
away_bullpen_pitches_24h INTEGER
home_bullpen_pitches_48h INTEGER
away_bullpen_pitches_48h INTEGER
closer_used_home BOOLEAN
closer_used_away BOOLEAN
doubleheader_flag BOOLEAN
home_lineup_posted BOOLEAN
away_lineup_posted BOOLEAN
missing_regulars_home TEXT
missing_regulars_away TEXT
edge_score NUMERIC
edge_grade TEXT
context_signals JSONB
created_at TIMESTAMPTZ DEFAULT now()
updated_at TIMESTAMPTZ DEFAULT now()
```

### rlm_alerts — add columns
```sql
moneyline_move NUMERIC
home_ml_open NUMERIC
home_ml_current NUMERIC
sp_alert BOOLEAN
weather_alert BOOLEAN
movement_time_bucket TEXT
buyback_confirmed BOOLEAN
cross_market_confirmed BOOLEAN
edge_score NUMERIC
edge_grade TEXT
```

---

## 8. Smart Polling Schedule

| Time Before Game | Poll Rate | Rationale |
|-----------------|-----------|-----------|
| >12 hours | Skip | No signal value |
| 3–12 hours | Every 30 min | Early sharp tracking |
| 1–3 hours | Every 15 min | Morning action window |
| <1 hour | Every 5 min | Pre-game action |
| Final 10 min | Every 1 min | Last-minute sharp moves |

Reduces API usage ~75% vs constant polling.

---

## 9. Cron Schedule

| Function | Frequency |
|----------|-----------|
| fetch-odds (smart) | Per schedule above |
| fetch-mlb-context | Every 30 min |
| detect-rlm | Every 5 min |
| detect-velocity | Every 5 min |
| detect-frozen | Every 10 min |
| closing-line fetch | Final hour |
| nightly-audit | 3AM CT |

---

## 10. HSA Updates for MLB

Every MLB game brief analyzes:
- Starting pitchers (regression score, recent form)
- Injury/lineup reports
- Bullpen fatigue
- Weather and park factors
- Travel context
- Narrative classification: explains move vs. strengthens signal

---

## 11. Frontend — MLB Game Card

Display per game:
- Away @ Home + Starting Pitcher Matchup
- Moneyline (primary) | Runline (secondary) | Total (tertiary)
- Edge Grade badge (A+/A/B+/B/C/D)
- Badges: Pitcher | Weather | Timing | Syndicate | Cross-Market
- Moneyline movement in cents (not spread points)

---

## 12. Scope Exclusions (v2)
- Player props
- Live in-game betting signals
- F5 (first 5 innings) markets
- International baseball leagues
- Automated bet placement

---

## 13. Implementation Order

1. SQL migrations (odds_snapshots update + mlb_game_context)
2. Update fetch-odds for MLB sport keys + moneyline tracking
3. Build fetch-mlb-context (weather + pitcher + bullpen)
4. Update detect-rlm for MLB cent thresholds
5. Update detect-velocity for MLB
6. Update HSA prompt for MLB context
7. Add cron jobs
8. Update frontend TypeScript types
9. Build MLB game card + badges
10. QA before Opening Day

---

## 14. Success Criteria

- MLB games appear within 5 min of odds posting
- Starting pitchers display correctly
- Weather signals trigger automatically
- Moneyline movement detection works with correct cent thresholds
- Stale line alerts fire correctly
- Syndicate buyback pattern detection works
- API usage stays under smart polling budget

---

*Last updated: March 15, 2026 — Consolidated from Claude PRD v2.1 + ChatGPT expansion doc*
*Owner: HHG LLC | Leemy*
