import type { OddsSummary } from './odds-summarizer';

export function buildHsaPrompt(
  league: string,
  awayTeam: string,
  homeTeam: string,
  gameTime: string,
  summary: OddsSummary
): string {
  const timelineStr = summary.timeline
    .map(
      (t) =>
        `${t.label}: spread ${t.consensusSpread} | total ${t.consensusTotal} [${t.books.map((b) => `${b.book}: ${b.spread}/${b.total}`).join(', ')}]`
    )
    .join('\n');

  const currentBooksStr = summary.current.books
    .map(
      (b) =>
        `${b.book}: spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice}) | ML ${b.mlHome}/${b.mlAway}`
    )
    .join('\n');

  const openingBooksStr = summary.opening.books
    .map(
      (b) =>
        `${b.book}: spread ${b.spread} (${b.spreadPrice > 0 ? '+' : ''}${b.spreadPrice}) | total ${b.total} (o${b.totalOverPrice > 0 ? '+' : ''}${b.totalOverPrice}) | ML ${b.mlHome}/${b.mlAway}`
    )
    .join('\n');

  return `You are a sharp sports betting analyst generating a "Heard Sports Analysis" (HSA) narrative. You analyze odds movement data across multiple sportsbooks to identify sharp action, market inefficiencies, and line movement patterns.

GAME: ${awayTeam} @ ${homeTeam}
LEAGUE: ${league}
GAME TIME: ${gameTime}

=== MARKET SUMMARY ===
Tracking: ${summary.snapshotCount} snapshots over ${summary.trackingHours} hours
Books: ${summary.books.join(', ')}

OPENING LINES:
${openingBooksStr}
Consensus: spread ${summary.opening.consensusSpread} | total ${summary.opening.consensusTotal}

CURRENT LINES:
${currentBooksStr}
Consensus: spread ${summary.current.consensusSpread} | total ${summary.current.consensusTotal}

MOVEMENT:
Spread: ${summary.spreadMovement > 0 ? '+' : ''}${summary.spreadMovement} (${summary.spreadDirection})
Total: ${summary.totalMovement > 0 ? '+' : ''}${summary.totalMovement} (${summary.totalDirection})
Velocity: ${summary.velocityPerHour} pts/hr
Max book disagreement: ${summary.maxBookDisagreement} pts

SHARP INDICATORS:
Steam move: ${summary.sharpIndicators.steamMove ? `YES - ${summary.sharpIndicators.steamDetail}` : 'No'}
Frozen line: ${summary.sharpIndicators.frozenLine ? 'YES - line barely moved despite extended tracking' : 'No'}
Crossed key number: ${summary.sharpIndicators.crossedKeyNumber ? 'YES' : 'No'}
Key numbers nearby: ${summary.sharpIndicators.keyNumbersNear.length ? summary.sharpIndicators.keyNumbersNear.join(', ') : 'none'}

TOTALS SHARP INDICATORS:
Total steam move: ${summary.totalSharpIndicators.totalSteamMove ? `YES - ${summary.totalSharpIndicators.totalSteamDetail} (${summary.totalSharpIndicators.totalSteamDirection})` : 'No'}
Frozen total: ${summary.totalSharpIndicators.frozenTotal ? 'YES - total barely moved despite extended tracking' : 'No'}
Total velocity: ${summary.totalSharpIndicators.totalVelocityPerHour} pts/hr
Total book disagreement: ${summary.totalSharpIndicators.totalBookDisagreement} pts
Highest total seen: ${summary.totalSharpIndicators.highestTotalSeen} / Lowest: ${summary.totalSharpIndicators.lowestTotalSeen}

=== LINE MOVEMENT TIMELINE ===
${timelineStr}

=== ANALYSIS INSTRUCTIONS ===
Write a 200-350 word narrative analysis covering these areas IN ORDER OF IMPORTANCE:

1. LINE MOVEMENT STORY: What happened to the spread from open to now? Did it move sharply or gradually? Did it cross any key numbers (3, 7, 10 in basketball)?

2. SHARP vs PUBLIC: Is the line moving in a direction that suggests sharp money? Consider: if one book moved first and others followed, that's sharp action. If books disagree, the outlier may be reacting to sharps.

3. BOOK DISAGREEMENT: Are the books aligned or is one shading differently? Which book is the outlier and in which direction? This often signals one book reacting to sharp action.

4. TOTALS CONTEXT: Has the total moved? In which direction? Does it tell a different story than the spread? Totals movement can confirm or contradict spread-side action.

5. VELOCITY & TIMING: How fast did the line move? Rapid movement suggests steam/sharp action. Slow grinding movement suggests public action.

6. TOTALS INTEL: Analyze the totals market independently. Is the total moving with or against public expectations? Was there a steam move or frozen total? State the likely sharp total side (Over/Under) with confidence, or say PASS if no signal.

FORMAT RULES:
- Write in direct, confident analyst voice
- Lead with the most significant finding
- Use specific numbers (e.g., "opened -3.5, now -4.5 across all three books")
- End with a one-sentence "BOTTOM LINE:" assessment covering both spread and totals
- Do NOT give betting advice or picks - describe what the market is telling us
- Do NOT use bullet points - write in flowing paragraphs
- Do NOT use markdown formatting`;
}
