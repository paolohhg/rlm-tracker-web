/**
 * Line Resistance Tracker
 *
 * Detects situations where the public is heavily on one side but the
 * line is not moving in that direction — suggesting book resistance
 * or sharp money on the other side.
 */

export interface ResistanceInput {
  openSpread: number | null;
  currentSpread: number | null;
  consensusHomePct: number | null;
  consensusAwayPct: number | null;
  /** Millisecond timestamp when the opening line was captured */
  openTimestamp: string | null;
}

export interface ResistanceResult {
  isResistance: boolean;
  resistanceScore: number;
  resistanceReason: string | null;
}

/**
 * Returns how much the spread moved TOWARD the given side becoming less attractive.
 * Positive = line moved toward that side (public gets worse number)
 * Zero     = flat
 * Negative = line moved AWAY from that side (public gets better number — resistance signal)
 *
 * SPREAD CONVENTION: Spreads are stored as home-team spread.
 * Negative = home favored (e.g. -4.5 means home is 4.5-point favorite).
 * When home is the public side and the line goes from -4.5 to -3.0,
 * that means the home side is getting a BETTER number (less favored),
 * so the line moved AWAY from home — that's resistance.
 *
 * movementTowardSide('home') = openSpread - currentSpread
 *   e.g. -4.5 - (-3.0) = -1.5 → negative means line moved away from home (resistance)
 * movementTowardSide('away') = currentSpread - openSpread
 *   e.g. -3.0 - (-4.5) = +1.5 → positive means line moved toward away (no resistance)
 */
function movementTowardSide(
  openSpread: number,
  currentSpread: number,
  side: 'home' | 'away'
): number {
  if (side === 'home') {
    return openSpread - currentSpread;
  }
  return currentSpread - openSpread;
}

export function computeResistance(input: ResistanceInput): ResistanceResult {
  const { openSpread, currentSpread, consensusHomePct, consensusAwayPct, openTimestamp } = input;

  const none: ResistanceResult = { isResistance: false, resistanceScore: 0, resistanceReason: null };

  if (openSpread === null || currentSpread === null) return none;
  if (consensusHomePct === null || consensusAwayPct === null) return none;

  const publicSide: 'home' | 'away' = consensusHomePct > consensusAwayPct ? 'home' : 'away';
  const publicPct = Math.max(consensusHomePct, consensusAwayPct);

  // Only evaluate resistance if public is heavily on one side
  if (publicPct < 70) return none;

  const moveTowardPublic = movementTowardSide(openSpread, currentSpread, publicSide);

  // Derive minutesSinceOpen if timestamp available
  const hasTime = openTimestamp !== null;
  const minutesSinceOpen = hasTime
    ? (Date.now() - new Date(openTimestamp).getTime()) / 60000
    : null;

  let score = 0;

  // Public consensus contribution (max +2)
  if (publicPct >= 70) score += 1;
  if (publicPct >= 75) score += 1;

  // Time contribution (max +2, only if available)
  if (minutesSinceOpen !== null) {
    if (minutesSinceOpen >= 60) score += 1;
    if (minutesSinceOpen >= 120) score += 1;
  }

  // Movement contribution (max +3, tiered — conditions are independent)
  if (moveTowardPublic < 0.5) score += 1;
  if (moveTowardPublic <= 0) score += 1;
  if (moveTowardPublic < 0) score += 1; // additional point for active counter-movement

  // Threshold rules
  let isResistance = false;
  if (hasTime) {
    isResistance = score >= 4;
  } else {
    // Without time data we can score max 5 (2 consensus + 3 movement).
    // Require score >= 4 AND active counter-movement to prevent false positives.
    isResistance = score >= 4 && publicPct >= 70 && moveTowardPublic < 0;
  }

  // Reason string
  let resistanceReason: string | null = null;
  if (isResistance) {
    if (moveTowardPublic < 0) {
      resistanceReason = `Public heavy on ${publicSide} side but line is moving against them`;
    } else if (moveTowardPublic < 0.5) {
      resistanceReason = `Public heavy on ${publicSide} side but line has not moved enough`;
    } else {
      resistanceReason = `Public heavy on ${publicSide} side but line is holding`;
    }
  }

  return { isResistance, resistanceScore: score, resistanceReason };
}
