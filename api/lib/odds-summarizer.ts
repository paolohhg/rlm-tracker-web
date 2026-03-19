// NOTE: This is the reference copy of the odds summarizer.
// The canonical copy used by the HSA pipeline is INLINED in api/generate-hsa.ts
// due to Vercel bundler constraints. Keep both in sync when making changes.

export interface OddsSnapshot {
  bookmaker: string;
  spread: number;
  spread_home_price: number;
  moneyline_home: number;
  moneyline_away: number;
  total: number;
  total_over_price: number;
  fetched_at: string;
}

export interface BookLine {
  book: string;
  spread: number;
  spreadPrice: number;
  total: number;
  totalOverPrice: number;
  mlHome: number;
  mlAway: number;
}

export interface TimelinePoint {
  minutesBefore: number;
  label: string;
  books: BookLine[];
  consensusSpread: number;
  consensusTotal: number;
}

export interface OddsSummary {
  snapshotCount: number;
  trackingHours: number;
  books: string[];
  opening: {
    time: string;
    books: BookLine[];
    consensusSpread: number;
    consensusTotal: number;
  };
  current: {
    time: string;
    books: BookLine[];
    consensusSpread: number;
    consensusTotal: number;
  };
  spreadMovement: number;
  totalMovement: number;
  spreadDirection: string;
  totalDirection: string;
  velocityPerHour: number;
  maxBookDisagreement: number;
  timeline: TimelinePoint[];
  sharpIndicators: {
    steamMove: boolean;
    steamDetail: string | null;
    consensusLine: boolean;
    crossedKeyNumber: boolean;
    keyNumbersNear: number[];
  };
  totalSharpIndicators: {
    totalSteamMove: boolean;
    totalSteamDetail: string | null;
    totalSteamDirection: 'over' | 'under' | null;
    consensusTotal: boolean;
    totalVelocityPerHour: number;
    highestTotalSeen: number;
    lowestTotalSeen: number;
    totalBookDisagreement: number;
  };
}

function avg(nums: number[]): number {
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toBookLine(snap: OddsSnapshot): BookLine {
  return {
    book: snap.bookmaker,
    spread: snap.spread,
    spreadPrice: snap.spread_home_price,
    total: snap.total,
    totalOverPrice: snap.total_over_price,
    mlHome: snap.moneyline_home,
    mlAway: snap.moneyline_away,
  };
}

function minutesBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 60000;
}

const BASKETBALL_KEY_NUMBERS = [3, 4, 5, 6, 7, 8, 10, 14];

export function summarizeOdds(
  snapshots: OddsSnapshot[],
  gameTime: string
): OddsSummary {
  if (!snapshots.length) {
    return {
      snapshotCount: 0,
      trackingHours: 0,
      books: [],
      opening: { time: '', books: [], consensusSpread: 0, consensusTotal: 0 },
      current: { time: '', books: [], consensusSpread: 0, consensusTotal: 0 },
      spreadMovement: 0,
      totalMovement: 0,
      spreadDirection: 'stable',
      totalDirection: 'stable',
      velocityPerHour: 0,
      maxBookDisagreement: 0,
      timeline: [],
      sharpIndicators: {
        steamMove: false,
        steamDetail: null,
        consensusLine: false,
        crossedKeyNumber: false,
        keyNumbersNear: [],
      },
      totalSharpIndicators: {
        totalSteamMove: false,
        totalSteamDetail: null,
        totalSteamDirection: null,
        consensusTotal: false,
        totalVelocityPerHour: 0,
        highestTotalSeen: 0,
        lowestTotalSeen: 0,
        totalBookDisagreement: 0,
      },
    };
  }

  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime()
  );

  const books = [...new Set(sorted.map((s) => s.bookmaker))];
  const firstTime = sorted[0].fetched_at;
  const lastTime = sorted[sorted.length - 1].fetched_at;
  const trackingHours = round1(minutesBetween(firstTime, lastTime) / 60);

  // Opening: earliest snapshot per book
  const openingByBook: Record<string, OddsSnapshot> = {};
  for (const s of sorted) {
    if (!openingByBook[s.bookmaker]) openingByBook[s.bookmaker] = s;
  }
  const openingBooks = Object.values(openingByBook).map(toBookLine);
  const openingConsensusSpread = round1(avg(openingBooks.map((b) => b.spread)));
  const openingConsensusTotal = round1(avg(openingBooks.map((b) => b.total)));

  // Current: latest snapshot per book
  const currentByBook: Record<string, OddsSnapshot> = {};
  for (const s of sorted) {
    currentByBook[s.bookmaker] = s;
  }
  const currentBooks = Object.values(currentByBook).map(toBookLine);
  const currentConsensusSpread = round1(avg(currentBooks.map((b) => b.spread)));
  const currentConsensusTotal = round1(avg(currentBooks.map((b) => b.total)));

  // Movement
  const spreadMovement = round1(currentConsensusSpread - openingConsensusSpread);
  const totalMovement = round1(currentConsensusTotal - openingConsensusTotal);

  const spreadDirection =
    Math.abs(spreadMovement) < 0.5
      ? 'stable'
      : spreadMovement < 0
        ? 'toward home favorite'
        : 'toward away / home underdog';

  const totalDirection =
    Math.abs(totalMovement) < 0.5
      ? 'stable'
      : totalMovement > 0
        ? 'over'
        : 'under';

  const velocityPerHour =
    trackingHours > 0 ? round1(Math.abs(spreadMovement) / trackingHours) : 0;

  // Book disagreement
  const currentSpreads = currentBooks.map((b) => b.spread);
  const maxBookDisagreement =
    currentSpreads.length > 1
      ? round1(Math.max(...currentSpreads) - Math.min(...currentSpreads))
      : 0;

  // Timeline: sample every ~30 min
  const gameTimeMs = new Date(gameTime).getTime();
  const timeGroups: Record<string, OddsSnapshot[]> = {};
  for (const s of sorted) {
    // Group by 30-min buckets
    const bucket = Math.floor(new Date(s.fetched_at).getTime() / (30 * 60000));
    const key = String(bucket);
    if (!timeGroups[key]) timeGroups[key] = [];
    timeGroups[key].push(s);
  }

  const timeline: TimelinePoint[] = Object.values(timeGroups).map((group) => {
    const mid = group[Math.floor(group.length / 2)];
    const minsBefore = Math.round(
      (gameTimeMs - new Date(mid.fetched_at).getTime()) / 60000
    );
    const label =
      minsBefore > 60
        ? `${Math.round(minsBefore / 60)}h before`
        : `${minsBefore}m before`;
    const booksInGroup: Record<string, OddsSnapshot> = {};
    for (const s of group) booksInGroup[s.bookmaker] = s;
    const bl = Object.values(booksInGroup).map(toBookLine);
    return {
      minutesBefore: minsBefore,
      label,
      books: bl,
      consensusSpread: round1(avg(bl.map((b) => b.spread))),
      consensusTotal: round1(avg(bl.map((b) => b.total))),
    };
  });

  timeline.sort((a, b) => b.minutesBefore - a.minutesBefore);

  // Sharp indicators
  // Steam move: >1 point move in <30 min window
  let steamMove = false;
  let steamDetail: string | null = null;
  for (let i = 1; i < timeline.length; i++) {
    const diff = Math.abs(timeline[i].consensusSpread - timeline[i - 1].consensusSpread);
    const timeDiff = timeline[i - 1].minutesBefore - timeline[i].minutesBefore;
    if (diff >= 1 && timeDiff <= 30) {
      steamMove = true;
      steamDetail = `${diff}-point move in ~${timeDiff} min (${timeline[i - 1].label} to ${timeline[i].label})`;
      break;
    }
  }

  // Consensus line: tracked for >2h with <0.5 movement — market agrees on the number
  const consensusLine = trackingHours >= 2 && Math.abs(spreadMovement) < 0.5;

  // Key number crossing
  const openAbsSpread = Math.abs(openingConsensusSpread);
  const currentAbsSpread = Math.abs(currentConsensusSpread);
  const crossedKeyNumber = BASKETBALL_KEY_NUMBERS.some(
    (k) =>
      (openAbsSpread < k && currentAbsSpread >= k) ||
      (openAbsSpread > k && currentAbsSpread <= k)
  );
  const keyNumbersNear = BASKETBALL_KEY_NUMBERS.filter(
    (k) => Math.abs(currentAbsSpread - k) <= 1
  );

  // Totals sharp indicators
  let totalSteamMove = false;
  let totalSteamDetail: string | null = null;
  let totalSteamDirection: 'over' | 'under' | null = null;
  for (let i = 1; i < timeline.length; i++) {
    const diff = timeline[i].consensusTotal - timeline[i - 1].consensusTotal;
    const absDiff = Math.abs(diff);
    const timeDiff = timeline[i - 1].minutesBefore - timeline[i].minutesBefore;
    if (absDiff >= 1 && timeDiff <= 30) {
      totalSteamMove = true;
      totalSteamDirection = diff > 0 ? 'over' : 'under';
      totalSteamDetail = `${absDiff}-point total move in ~${timeDiff} min (${timeline[i - 1].label} to ${timeline[i].label})`;
      break;
    }
  }

  const consensusTotal = trackingHours >= 2 && Math.abs(totalMovement) < 0.5;
  const totalVelocityPerHour =
    trackingHours > 0 ? round1(Math.abs(totalMovement) / trackingHours) : 0;

  const timelineTotals = timeline.map((t) => t.consensusTotal).filter((t) => t > 0);
  const highestTotalSeen = timelineTotals.length ? round1(Math.max(...timelineTotals)) : openingConsensusTotal;
  const lowestTotalSeen = timelineTotals.length ? round1(Math.min(...timelineTotals)) : openingConsensusTotal;

  const currentTotalsArr = currentBooks.map((b) => b.total).filter((t) => t > 0);
  const totalBookDisagreement =
    currentTotalsArr.length > 1
      ? round1(Math.max(...currentTotalsArr) - Math.min(...currentTotalsArr))
      : 0;

  // Anomaly detection: flag suspiciously wide total ranges (possible data contamination)
  const totalRange = highestTotalSeen - lowestTotalSeen;
  if (totalRange > 15 && highestTotalSeen > 0 && lowestTotalSeen > 0) {
    console.warn(`[HSA ANOMALY] Total range ${totalRange}pts (${lowestTotalSeen}–${highestTotalSeen}) — possible market contamination`);
  }

  return {
    snapshotCount: snapshots.length,
    trackingHours,
    books,
    opening: {
      time: firstTime,
      books: openingBooks,
      consensusSpread: openingConsensusSpread,
      consensusTotal: openingConsensusTotal,
    },
    current: {
      time: lastTime,
      books: currentBooks,
      consensusSpread: currentConsensusSpread,
      consensusTotal: currentConsensusTotal,
    },
    spreadMovement,
    totalMovement,
    spreadDirection,
    totalDirection,
    velocityPerHour,
    maxBookDisagreement,
    timeline,
    sharpIndicators: {
      steamMove,
      steamDetail,
      consensusLine,
      crossedKeyNumber,
      keyNumbersNear,
    },
    totalSharpIndicators: {
      totalSteamMove,
      totalSteamDetail,
      totalSteamDirection,
      consensusTotal,
      totalVelocityPerHour,
      highestTotalSeen,
      lowestTotalSeen,
      totalBookDisagreement,
    },
  };
}
