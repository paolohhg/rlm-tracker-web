# Heard Sports Intelligence — System Documentation

**Owner:** Heard Hospitality Group LLC
**Platform:** RLM Tracker Web
**Version:** March 2026

---

## Table of Contents

1. [Overview](#1-overview)
2. [Core Philosophy](#2-core-philosophy)
3. [Tech Stack](#3-tech-stack)
4. [Architecture](#4-architecture)
5. [Data Pipeline](#5-data-pipeline)
6. [Signal Detection Engine](#6-signal-detection-engine)
7. [The Heard Method](#7-the-heard-method)
8. [Dashboard](#8-dashboard)
9. [Morning Report](#9-morning-report)
10. [Heard 2H Analysis](#10-heard-2h-analysis)
11. [HSA (Heard Sports Analysis)](#11-hsa-heard-sports-analysis)
12. [ShareStudio](#12-sharestudio)
13. [MLB Expansion](#13-mlb-expansion)
14. [Database Schema](#14-database-schema)
15. [External Services & APIs](#15-external-services--apis)
16. [Deployment & Cron Jobs](#16-deployment--cron-jobs)
17. [Directory Structure](#17-directory-structure)

---

## 1. Overview

Heard Sports Intelligence is a **professional sports betting market intelligence platform** that tracks sportsbook behavior in real time across **NBA, NCAAB, NHL, and MLB**. It surfaces reverse line movement (RLM), steam moves, frozen lines, and other market inefficiencies by analyzing:

- Opening vs. current odds across multiple sportsbooks
- Public betting ticket and money percentages
- Line movement velocity and book coordination
- Market signals vs. narrative explanations

This is **not** a picks service or betting advisor. It is professional market intelligence infrastructure for understanding how sportsbooks respond to sharp (professional) money.

---

## 2. Core Philosophy

> **Sportsbooks are not predicting winners — they are managing risk against professional bettors.**

When a sportsbook moves a line *against* the direction public money is flowing, it indicates that sharp bettors have forced the move. The Heard system identifies these moments and ranks them by confidence.

**Key Principle:** Follow the money, not the narrative.

**What the system deliberately ignores:**

- Team trends and historical stats without market confirmation
- Analyst picks and social media narratives
- Gut feeling bets

---

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19 + TypeScript 5.9 |
| **Build Tool** | Vite 8 |
| **Routing** | React Router DOM 7 |
| **Backend** | Vercel Serverless Functions (Node/TypeScript) |
| **Database** | Supabase (PostgreSQL + real-time subscriptions) |
| **Edge Functions** | Supabase Edge Functions (Deno runtime) |
| **AI** | Anthropic Claude SDK (narrative generation) |
| **Export** | html-to-image (PNG card generation) |
| **Hosting** | Vercel (frontend + API) |
| **Styling** | Inline React CSSProperties (no CSS framework) |

---

## 4. Architecture

### Frontend

- **Component composition** with React hooks for state management
- **No external state library** — all state flows through custom hooks (`useGamesFeed`, `useOvernightReport`, `useHeard2H`, `useGenerateHsa`)
- Direct `fetch()` calls in hooks (no React Query / SWR)
- Supabase real-time subscriptions for live updates
- Inline styles using a centralized theme (`src/lib/theme.ts`)

### Backend

- **Vercel Serverless Functions** in `/api` — stateless, short-lived endpoints triggered by cron or frontend
- **Supabase Edge Functions** in `/supabase/functions` — CPU-intensive work (odds fetching, RLM detection) running on Deno
- RESTful GET/POST/PATCH patterns (no GraphQL)

### Data Flow

```
The Odds API ──► fetch-odds (edge fn) ──► odds_snapshots table
                                              │
Action Network ──► fetch-splits (API) ──► splits_snapshots table
                                              │
ESPN ──► useGamesFeed (frontend) ──────► game_scores table
                                              │
                    detect-rlm (edge fn) ◄────┘
                         │
                    tipoff_snapshots + rlm_alerts tables
                         │
                    Dashboard ◄──── Frontend renders all data
```

---

## 5. Data Pipeline

The system runs a continuous data pipeline on cron schedules:

| Job | Endpoint | Schedule | Source | Output |
|-----|----------|----------|--------|--------|
| **Fetch Odds** | `/api/fetch-odds` | Every 10 min | The Odds API | `odds_snapshots` |
| **Detect RLM** | `/api/detect-rlm` | Every 10 min (+3s offset) | `odds_snapshots` + `splits_snapshots` | `tipoff_snapshots`, `rlm_alerts` |
| **Fetch Splits** | `/api/fetch-splits` | Every 30 min (+5s offset) | Action Network | `splits_snapshots` |
| **Morning Report** | `/api/generate-overnight-report` | Daily 12 PM UTC | All tables | `overnight_reports` |

The frontend polls every 30 seconds for game data and scores, combining Supabase queries with ESPN live score fetches.

---

## 6. Signal Detection Engine

### Signal Tiers (ranked by strength)

| Tier | Signal | Conditions | Confidence |
|------|--------|------------|------------|
| 1 | **Double No-Narrative RLM** | RLM + no media narrative + confirmed across multiple books | Highest |
| 2 | **No-Narrative RLM** | RLM + no obvious injury/news narrative | High |
| 3 | **Steam Move** | Sudden synchronized line move across multiple books | High |
| 4 | **Frozen Line** | Heavy public action on one side + line refuses to move | Medium-High |
| 5 | **Book Shade** | Select books shading a line in a direction | Medium |
| 6 | **Contra Move** | Line moves contrary to expected direction | Medium |
| 7 | **Sharp Accumulation** | Gradual sharp-side buildup over time | Medium |
| 8 | **Watch** | Early movement, incomplete confirmation | Low |
| 9 | **Tracking** | Monitoring, no actionable signal yet | Lowest |

### Intelligence Layers

**Fake Steam Detection** — Identifies when a single outlier book moves but the broader market does not follow. Scores confidence that a "steam move" is actually isolated noise rather than a coordinated sharp move.

**Line Resistance Detection** — Flags games where sportsbooks refuse to move the line despite heavy one-sided public betting. This is a strong indicator that books are willing to take on liability because sharp money is on the other side.

### Narrative Filter

If a line move has a clear narrative explanation (injury, lineup change, suspension, weather), the signal is **downgraded**. This prevents acting on fake sharp signals that are simply the market reacting to news.

### Timing Rules

- **Early moves** (morning / overnight) → often sharp
- **Late moves** (close to game time) → often public volume
- The system tracks: opening line, current line, and velocity of movement

---

## 7. The Heard Method

The Heard Method is the betting methodology that the platform implements:

### Workflow

1. Collect opening lines from multiple sportsbooks
2. Monitor live line movement in real time
3. Track public betting percentages (tickets and money)
4. Detect RLM patterns (line moves opposite to public)
5. Filter out narrative explanations
6. Rank signal strength using the Signal Ladder
7. Identify the sharp side for action

### The Betting Cycle (Martingale Recovery)

The method bets the sharp side for the **1st half**:

| 1H Result | 2H Action | Cycle Record |
|-----------|-----------|--------------|
| Win | None needed | 1-0 |
| Loss | Double bet, same sharp side, 2H | — |
| Loss → 2H Win | Recovery complete | 1-0 |
| Loss → 2H Loss | Full cycle loss | 0-1 |

**Key rules:**
- Record is tracked at the **cycle** level, not the individual half
- A 1H loss recovered by a 2H win counts as **1-0** (not 1-1)
- The 2H bet is always the **same sharp side** — never flip
- 2H bet size = 2x the 1H bet (covers loss + profit)

---

## 8. Dashboard

**Component:** `src/components/Dashboard.tsx`

The primary view of the platform — a real-time game feed across all supported leagues.

### Features

- **League filtering** — NBA, NCAAB, NHL, MLB
- **Signal tier filtering** — Show only games above a certain signal strength
- **Status filtering** — Upcoming, Live, Final
- **Time-to-tipoff filtering** — Focus on games about to start
- **Tournament detection** — NCAA Tournament, NIT, CBI (NCAAB)
- **Color-coded signal badges** — Visual signal tier indicators
- **Per-game detail view:**
  - Spread and total movement (opening → current)
  - Public betting percentages (tickets + money)
  - Sharp team identification
  - HSA narrative (AI-generated market commentary)
  - Book agreement count
  - Line velocity
  - Moneyline movement
- **Live scores** — Updated from ESPN every 30 seconds
- **Fake Steam indicators** — Confidence-scored outlier detection
- **Line Resistance indicators** — When books refuse to move

---

## 9. Morning Report

**Component:** `src/components/OvernightReport.tsx`
**Engine:** `api/lib/overnight-report-engine.ts`

A daily summary generated at 12 PM UTC (8 AM ET) covering overnight market activity.

### Report Sections

- **Headline** — Top story of the morning
- **Quick Stats** — Summary numbers (games analyzed, signals detected, etc.)
- **Top Signals** — Highest-ranked overnight line movements
- **Frozen Line Watch** — Games where lines haven't moved despite public action
- **Market Themes** — Broader patterns across the slate
- **What to Watch** — Key games/situations for the day

### Report Generation

- Consumes odds snapshots from the 2 AM–12 PM UTC overnight window
- Analyzes all games across a league for that morning
- Reports are stored immutably in the `overnight_reports` table
- Statuses: `pending` → `complete` / `failed` / `insufficient_data`

### Admin Debug View

**Component:** `src/components/OvernightReportAdmin.tsx`

Internal view showing:
- Raw computed stats and window timing
- Game-by-game overnight analysis
- Manual regeneration trigger
- Historical date picker

---

## 10. Heard 2H Analysis

**Components:** `src/components/Heard2H/`
**Engine:** `src/lib/heard2h/`

A halftime betting analysis system that identifies mispriced second-half lines.

### Three-Layer Engine

**Layer 1 — MIP Engine (Mispricing Index)**
`src/lib/heard2h/mip-engine.ts`

- Scores 2H totals and sides for mispricing opportunities
- Compares halftime market lines against pregame implied second-half lines
- Outputs a mispricing score and verdict

**Layer 2 — Tempo Layer**
`src/lib/heard2h/tempo-layer.ts`

- Adjusts for in-game pace factors: fouls, turnovers, shooting percentage
- Accounts for game state (close game vs. blowout)
- Outputs a fair-value 2H total compared to the market line

**Layer 3 — Signal Layer**
`src/lib/heard2h/signal-layer.ts`

- Detects sharp-side confirmations on the 2H line
- Identifies RLM on 2H markets
- Accounts for foul trouble, key player returns

### Verdicts

Each analysis outputs one of: `strong_play` / `play` / `lean` / `no_play`

### Analytics Dashboard

**Component:** `src/components/Heard2H/Analytics.tsx`

Tracks historical results:
- Win rate by MIP tier and edge band
- Performance by sport and signal type
- Stored in `heard2h_games` with actual game outcomes

---

## 11. HSA (Heard Sports Analysis)

**Endpoint:** `/api/generate-hsa.ts`
**Prompt:** `api/lib/hsa-prompt.ts`

AI-powered market commentary generated by Anthropic Claude.

### Purpose

Provides professional, narrative-style analysis of market behavior for each game. Describes *what the market is doing*, not *what to bet*.

### Input Data

- Line movement direction and magnitude
- Book coordination (how many books moved together)
- Public betting percentages
- Money vs. ticket divergence
- Timing of moves

### Output

- **Status:** PASS / WATCH / ACTIVE
- **Confidence level**
- **Market lean explanation** — neutral, professional language
- **Snippet** — Short summary for the dashboard

### Guardrails

The system prompt enforces strict neutrality:
- Never says "bet this", "pick", "lock", "guaranteed"
- Describes market behavior only
- Distinguishes between sharp signals and noise

---

## 12. ShareStudio

**Component:** `src/components/ShareStudio.tsx`

Generates social-media-ready PNG cards from game analysis data.

### Features

- Custom 2D canvas rendering for high-quality image export
- Multiple card templates (market analysis, signal alerts, morning report highlights)
- Post text generators in `src/lib/share/post-generators.ts`
- Export via `html-to-image` library

---

## 13. MLB Expansion

**Status:** Ready for development (target: Opening Day March 26, 2026)
**Full PRD:** `MLB_PRD.md`

### Five-Layer Intelligence

1. **Market Intelligence** — Inherited from the existing RLM engine (moneyline-adapted)
2. **Starting Pitcher Engine** — ERA, xERA, FIP, form trends
3. **Bullpen Engine** — Fatigue index, usage patterns, rest days
4. **Lineup Engine** — Missing regulars, batting order strength, handedness splits
5. **Environment Engine** — Weather, wind, ballpark factors, temperature

### MLB-Specific Signal Tiers

| Signal | Description |
|--------|-------------|
| SYNDICATE CONFIRMED | Buyback pattern: Move → Reversal → Continuation within 90min |
| DOUBLE ML RLM | ML moves 15+ cents vs. public, 4+ books, no narrative |
| ML RLM | Standard moneyline reverse line movement |
| STEAM MOVE | Synchronized ML move across books |
| STALE LINE | Book slow to adjust |
| RUNLINE DIVERGE | Runline and ML disagreeing |
| WEATHER TOTAL | Total movement driven by weather conditions |
| PITCHER ALERT | Pitcher-driven market signal |
| FROZEN JUICE | Juice shifts without line movement |

### Edge Grade System

Every MLB game receives a grade from **A+** (highest conviction) to **D** (noise):

| Grade | Requirements |
|-------|-------------|
| A+ | SYNDICATE + 2+ context confirmations (90+ pts) |
| A | Strong RLM + 1 context confirmation (75–89 pts) |
| B+ | RLM + weak context signal (60–74 pts) |
| B | Market signal only, no context (45–59 pts) |
| C | Context signal only, no market (25–44 pts) |
| D | Noise / stale / conflicting (under 25 pts) |

---

## 14. Database Schema

All data lives in **Supabase (PostgreSQL)**.

### Core Tables

| Table | Purpose |
|-------|---------|
| `odds_snapshots` | Every sportsbook's latest odds for every game — spread, total, moneyline, bookmaker, timestamp |
| `tipoff_snapshots` | RLM detection output — flagged games with signal tier, sharp team, scenario key |
| `rlm_alerts` | Detailed RLM analysis per game — side lean, total lean, confidence scores, 3-layer signal reads |
| `game_scores` | Live score snapshots from ESPN — home/away scores, period, game status |
| `splits_snapshots` | Public betting percentages per side and total — ticket %, money %, fetched timestamp |
| `claude_analyses` | Stored HSA narratives — cached AI-generated market analysis per game |
| `overnight_reports` | Daily morning reports per league — status, report payload (JSON), computed stats |
| `heard2h_games` | Halftime betting analysis + actual results — input/result JSON, final scores |
| `games_master` | Canonical game registry — unified game ID matching across data sources |
| `team_aliases` | Team name normalization — maps raw names from different sources to canonical names |

### Key Migrations

Located in `supabase/migrations/`:

- `002_initial_tables.sql` — Core odds, alerts, scores tables
- `003_hm_cycles.sql` — Martingale betting cycle tracking
- `004_mlb_expansion.sql` — MLB-specific tables and columns
- `005_heard2h_games.sql` — Halftime analysis storage
- `006_nhl_universal_scoring.sql` — NHL scoring normalization
- `007_three_layer_signal_reads.sql` — Enhanced signal analysis columns
- `008_canonical_game_matching.sql` — Cross-source game ID unification
- `009_overnight_reports.sql` — Morning report storage
- `010_total_coordination_details.sql` — Book coordination metadata

---

## 15. External Services & APIs

| Service | Purpose | Frequency |
|---------|---------|-----------|
| **The Odds API** | Opening and current spreads, totals, moneylines across 10+ sportsbooks | Every 10 minutes (cron) |
| **ESPN API** | Live scores, game status, period/clock, tournament detection | Every 30 seconds (frontend) |
| **Action Network** | Public betting percentages — ticket % and money % by team and total | Every 30 minutes (cron) |
| **Anthropic Claude** | HSA narrative generation — market behavior interpretation | On-demand per game |
| **Supabase** | PostgreSQL database, real-time subscriptions, edge function runtime | Continuous |

---

## 16. Deployment & Cron Jobs

### Vercel Deployment

- **Frontend:** `npm run build` → `tsc -b && vite build` → deployed to Vercel CDN
- **API:** Each `.ts` file in `/api` becomes a serverless function endpoint
- **Dev proxy:** Vite proxies `/api` requests to localhost during development

### Cron Schedule (vercel.json)

```json
{
  "crons": [
    { "path": "/api/fetch-odds",                  "schedule": "*/10 * * * *"  },
    { "path": "/api/detect-rlm",                  "schedule": "3/10 * * * *"  },
    { "path": "/api/fetch-splits",                 "schedule": "5/30 * * * *"  },
    { "path": "/api/generate-overnight-report",    "schedule": "0 12 * * *"   }
  ]
}
```

### Supabase Edge Functions

Located in `supabase/functions/`:
- `fetch-odds/` — Calls The Odds API, writes to `odds_snapshots`
- `detect-rlm/` — Reads snapshots, runs RLM detection, writes alerts
- `compute-hsa-score/` — Scores games for HSA priority
- `fetch-mlb-context/` — MLB-specific context data
- `fetch-nhl-context/` — NHL-specific context data
- `debug-sports/` — Internal debugging

---

## 17. Directory Structure

```
rlm-tracker-web/
├── src/
│   ├── components/
│   │   ├── Dashboard.tsx            # Main real-time game feed
│   │   ├── OvernightReport.tsx      # Morning report view
│   │   ├── OvernightReportAdmin.tsx # Admin debug for reports
│   │   ├── ShareStudio.tsx          # Social media card generator
│   │   ├── TickerBar.tsx            # Top-of-page signal ticker
│   │   └── Heard2H/                # Halftime betting analysis
│   │       ├── Heard2HTab.tsx       # Tab container
│   │       ├── AnalysisForm.tsx     # Input form
│   │       ├── AnalysisResult.tsx   # Result display
│   │       ├── GameLog.tsx          # Historical game log
│   │       └── Analytics.tsx        # Win rate analytics
│   ├── hooks/
│   │   ├── useGamesFeed.ts          # Multi-source game aggregation
│   │   ├── useOvernightReport.ts    # Morning report fetching
│   │   ├── useHeard2H.ts            # 2H analysis CRUD
│   │   └── useGenerateHsa.ts        # HSA narrative generation
│   ├── lib/
│   │   ├── theme.ts                 # Design tokens (colors, fonts, spacing)
│   │   ├── supabase.ts              # Supabase client initialization
│   │   ├── heard2h/                 # Halftime engine
│   │   │   ├── pipeline.ts          # Full analysis pipeline
│   │   │   ├── mip-engine.ts        # Mispricing index calculator
│   │   │   ├── tempo-layer.ts       # Pace/foul/shooting adjustments
│   │   │   ├── signal-layer.ts      # Sharp-side signal detection
│   │   │   ├── analytics.ts         # Win-rate computation
│   │   │   └── types.ts             # Type definitions
│   │   ├── intelligence/
│   │   │   ├── resistance.ts        # Line resistance detection
│   │   │   └── fake-steam.ts        # Book outlier detection
│   │   └── share/
│   │       └── post-generators.ts   # Social post text templates
│   ├── types/
│   │   └── index.ts                 # Global types (GameView, SignalTier, etc.)
│   ├── App.tsx                      # Root app with tab navigation
│   └── main.tsx                     # Entry point
├── api/                             # Vercel serverless functions
│   ├── fetch-odds.ts                # Cron: trigger odds fetch
│   ├── detect-rlm.ts               # Cron: trigger RLM detection
│   ├── fetch-splits.ts             # Cron: fetch public betting splits
│   ├── generate-overnight-report.ts # Cron: daily morning report
│   ├── generate-hsa.ts             # On-demand: HSA narrative generation
│   ├── overnight-report.ts         # Read: fetch stored reports
│   ├── heard2h-games.ts            # CRUD: halftime analysis
│   └── lib/
│       ├── overnight-report-engine.ts # Report generation logic
│       ├── market-lifecycle-engine.ts # Game market analysis
│       ├── market-consensus.ts       # Consensus line computation
│       ├── odds-summarizer.ts        # Odds formatting
│       └── hsa-prompt.ts            # Claude system prompt for HSA
├── supabase/
│   ├── functions/                   # Edge functions (Deno)
│   │   ├── fetch-odds/
│   │   ├── detect-rlm/
│   │   ├── compute-hsa-score/
│   │   ├── fetch-mlb-context/
│   │   ├── fetch-nhl-context/
│   │   └── debug-sports/
│   └── migrations/                  # PostgreSQL schema migrations
├── public/                          # Static assets (logos)
├── vercel.json                      # Deployment + cron config
├── vite.config.ts                   # Build configuration
├── package.json                     # Dependencies
├── HEARD_METHOD.md                  # Betting methodology docs
└── MLB_PRD.md                       # MLB expansion PRD (v3.0)
```

---

## Authentication & Access

This is an **internal company tool** — there is no user authentication layer.

- **Frontend:** Uses Supabase anonymous key (`VITE_SUPABASE_ANON_KEY`)
- **API routes:** Use Supabase service role key (`SUPABASE_SERVICE_ROLE_KEY`) for writes
- **RLS:** Permissive policies on core tables (internal use only)

---

## Key Dependencies

```
react 19.2          — UI framework
react-router-dom 7  — Client-side routing
@supabase/supabase-js 2.98 — Database client
@anthropic-ai/sdk 0.78    — Claude AI for HSA narratives
@vercel/node 5.6          — Serverless function runtime
html-to-image 1.11        — PNG export for ShareStudio
typescript 5.9             — Type safety
vite 8.0                   — Build tool
```
