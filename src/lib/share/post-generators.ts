import type { GameView, SignalTier } from '../../types';

// ── Option Types ─────────────────────────────────────────────

export interface AlertOptions {
  showTicketPct: boolean;
  showMoneyPct: boolean;
  showBookCount: boolean;
  showTimestamp: boolean;
}

export interface SignalOptions {
  showSupportingData: boolean;
  showConfidence: boolean;
}

export const DEFAULT_ALERT_OPTIONS: AlertOptions = {
  showTicketPct: true,
  showMoneyPct: true,
  showBookCount: true,
  showTimestamp: true,
};

export const DEFAULT_SIGNAL_OPTIONS: SignalOptions = {
  showSupportingData: true,
  showConfidence: true,
};

// ── Helpers ──────────────────────────────────────────────────

function formatSpread(spread: number | null): string {
  if (spread == null) return 'N/A';
  return spread > 0 ? `+${spread}` : `${spread}`;
}

function spreadDirection(game: GameView): string {
  const open = game.openingSpread;
  const current = game.currentSpread;
  if (open == null || current == null) return '';
  const move = current - open;
  if (Math.abs(move) < 0.5) return 'Line holding steady';
  // Negative spread = home favored. Line going more negative = moving toward home.
  if (move < 0) return `Line moving toward ${game.homeTeam}`;
  return `Line moving toward ${game.awayTeam}`;
}

export function deriveConfidenceLabel(signalTier: SignalTier): string {
  switch (signalTier) {
    case 'DOUBLE NO-NARRATIVE RLM': return 'Very High';
    case 'NO-NARRATIVE RLM': return 'High';
    case 'STEAM MOVE': return 'Elevated';
    case 'FROZEN LINE': return 'Moderate';
    case 'BOOK SHADE': return 'Moderate';
    case 'CONTRA MOVE': return 'Moderate';
    case 'WATCH': return 'Low';
    case 'TRACKING': return 'Low';
    default: return 'Low';
  }
}

export function deriveTotalConfidenceLabel(game: GameView): string | null {
  if (game.openingTotal == null || game.currentTotal == null) return null;
  const totalMove = Math.abs(game.currentTotal - game.openingTotal);
  const hasOverUnderSplit = game.overTicketPct != null && game.underTicketPct != null;
  const hasOverUnderMoney = game.overMoneyPct != null && game.underMoneyPct != null;

  // Reverse total movement (line moving opposite to public) = stronger signal
  const isReverse = hasOverUnderSplit && (
    (game.currentTotal > game.openingTotal && game.underTicketPct! > game.overTicketPct!) ||
    (game.currentTotal < game.openingTotal && game.overTicketPct! > game.underTicketPct!)
  );

  if (totalMove >= 2 && isReverse) return 'High';
  if (totalMove >= 1.5 && isReverse) return 'Elevated';
  if (totalMove >= 1 || (totalMove >= 0.5 && (hasOverUnderMoney || hasOverUnderSplit))) return 'Moderate';
  if (totalMove >= 0.5) return 'Low';
  return null;
}

function signalTierLabel(tier: SignalTier): string {
  switch (tier) {
    case 'DOUBLE NO-NARRATIVE RLM': return 'Double RLM';
    case 'NO-NARRATIVE RLM': return 'Reverse Line Movement';
    case 'STEAM MOVE': return 'Steam Move';
    case 'FROZEN LINE': return 'Frozen Line';
    case 'BOOK SHADE': return 'Book Shade';
    case 'CONTRA MOVE': return 'Contra Move';
    default: return '';
  }
}

// ── Market Move Alert Post ───────────────────────────────────

export function generateAlertPost(game: GameView, options: AlertOptions): string {
  const lines: string[] = [];

  lines.push('MARKET MOVE');
  lines.push('');
  lines.push(`${game.awayTeam} @ ${game.homeTeam}`);

  // Spread movement
  if (game.openingSpread != null && game.currentSpread != null) {
    const moveAmt = game.lineMoveAmount != null ? Math.abs(game.lineMoveAmount) : Math.abs(game.currentSpread - game.openingSpread);
    lines.push(`${formatSpread(game.openingSpread)} \u2192 ${formatSpread(game.currentSpread)} (${moveAmt.toFixed(1)} pt move)`);
    lines.push(spreadDirection(game));
  } else if (game.currentSpread != null) {
    lines.push(`Current: ${formatSpread(game.currentSpread)}`);
  }

  lines.push('');

  // Conditional data lines
  if (options.showTicketPct && game.awayBetsPct != null && game.publicBetsPct != null) {
    lines.push(`Tickets: ${game.awayBetsPct}% ${game.awayTeam} / ${game.publicBetsPct}% ${game.homeTeam}`);
  }

  if (options.showMoneyPct && game.awayMoneyPct != null && game.publicMoneyPct != null) {
    lines.push(`Money: ${game.awayMoneyPct}% ${game.awayTeam} / ${game.publicMoneyPct}% ${game.homeTeam}`);
  }

  if (options.showBookCount && game.booksAgreeing != null && game.totalBooks != null) {
    lines.push(`Books moving: ${game.booksAgreeing}/${game.totalBooks}`);
  }

  // Total movement
  if (game.openingTotal != null && game.currentTotal != null && Math.abs(game.currentTotal - game.openingTotal) >= 0.5) {
    lines.push('');
    const totalDir = game.currentTotal > game.openingTotal ? 'Over' : 'Under';
    lines.push(`Total: ${game.openingTotal} \u2192 ${game.currentTotal} (moving ${totalDir})`);
    if (game.overTicketPct != null && game.underTicketPct != null) {
      lines.push(`Over/Under Tickets: ${game.overTicketPct}% / ${game.underTicketPct}%`);
    }
    if (game.overMoneyPct != null && game.underMoneyPct != null) {
      lines.push(`Over/Under Money: ${game.overMoneyPct}% / ${game.underMoneyPct}%`);
    }
    const totalConf = deriveTotalConfidenceLabel(game);
    if (totalConf) {
      lines.push(`Total Confidence: ${totalConf}`);
    }
  }

  // Signal description
  if (game.signalTier && game.signalTier !== 'WATCH' && game.signalTier !== 'TRACKING') {
    lines.push('');
    lines.push(signalTierLabel(game.signalTier) + ' detected.');
  }

  // Footer
  lines.push('');
  lines.push('HSI Market Tracker');
  if (options.showTimestamp) {
    lines.push(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }));
  }

  return lines.join('\n');
}

// ── Signal Post ──────────────────────────────────────────────

export function generateSignalPost(game: GameView, options: SignalOptions): string {
  const lines: string[] = [];

  lines.push('HSI SIGNAL');
  lines.push('');

  // Team + line
  if (game.sharpTeam) {
    lines.push(`${game.sharpTeam} ${formatSpread(game.currentSpread)}`);
  } else {
    lines.push(`${game.awayTeam} @ ${game.homeTeam}`);
    if (game.currentSpread != null) {
      const homeFavored = game.currentSpread < 0;
      const fav = homeFavored ? game.homeTeam : game.awayTeam;
      lines.push(`${fav} ${formatSpread(game.currentSpread)}`);
    }
  }

  // Supporting data
  if (options.showSupportingData) {
    lines.push('');
    if (game.booksAgreeing != null && game.totalBooks != null) {
      lines.push(`Books aligned: ${game.booksAgreeing}/${game.totalBooks}`);
    }
    if (game.signalTier && game.signalTier !== 'WATCH' && game.signalTier !== 'TRACKING') {
      lines.push(`Signal: ${signalTierLabel(game.signalTier)}`);
    }
    if (game.velocityPerHour != null && game.velocityPerHour > 0) {
      lines.push(`Velocity: ${game.velocityPerHour} pts/hr`);
    }
  }

  // Confidence — side
  if (options.showConfidence && game.signalTier) {
    lines.push('');
    lines.push(`Side Confidence: ${deriveConfidenceLabel(game.signalTier)}`);
  }

  // Total data
  if (game.openingTotal != null && game.currentTotal != null && Math.abs(game.currentTotal - game.openingTotal) >= 0.5) {
    lines.push('');
    const totalDir = game.currentTotal > game.openingTotal ? 'Over' : 'Under';
    lines.push(`Total: ${game.openingTotal} \u2192 ${game.currentTotal} (${totalDir})`);
    if (options.showSupportingData) {
      if (game.overTicketPct != null && game.underTicketPct != null) {
        lines.push(`O/U Tickets: ${game.overTicketPct}% / ${game.underTicketPct}%`);
      }
    }
    if (options.showConfidence) {
      const totalConf = deriveTotalConfidenceLabel(game);
      if (totalConf) {
        lines.push(`Total Confidence: ${totalConf}`);
      }
    }
  }

  lines.push('');
  lines.push('Heard Sports Intelligence');

  return lines.join('\n');
}

// ── Explain Move ─────────────────────────────────────────────

export function generateExplainMove(game: GameView): string {
  if (game.openingSpread == null || game.currentSpread == null) {
    return `${game.awayTeam} @ ${game.homeTeam} \u2014 No line movement data available.`;
  }

  const move = Math.abs(game.currentSpread - game.openingSpread);
  if (move < 0.5) {
    return `${game.awayTeam} @ ${game.homeTeam} \u2014 The line has held steady at ${formatSpread(game.currentSpread)}. No significant movement detected.`;
  }

  const movedToward = game.currentSpread < game.openingSpread ? game.homeTeam : game.awayTeam;

  let explanation = `${game.awayTeam} @ ${game.homeTeam} \u2014 `;
  explanation += `The line moved from ${formatSpread(game.openingSpread)} to ${formatSpread(game.currentSpread)} (${move.toFixed(1)} points toward ${movedToward}).`;

  if (game.awayBetsPct != null && game.publicBetsPct != null) {
    const publicSideTeam = game.publicBetsPct > game.awayBetsPct ? game.homeTeam : game.awayTeam;
    const publicPct = Math.max(game.publicBetsPct, game.awayBetsPct);

    if (publicSideTeam !== movedToward && publicPct >= 55) {
      explanation += ` Despite ${publicPct}% of tickets on ${publicSideTeam}, the line moved the other way. This suggests sportsbooks respected sharper money on ${movedToward}.`;
    } else {
      explanation += ` ${publicPct}% of tickets are on ${publicSideTeam}, and the line is following public money.`;
    }
  }

  return explanation;
}
