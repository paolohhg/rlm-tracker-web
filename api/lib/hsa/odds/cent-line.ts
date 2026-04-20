/**
 * Cent-line utility — THE load-bearing primitive for all HSA juice math.
 *
 * American odds are discontinuous at the ±100 boundary. Raw subtraction
 * (current - open) produces phantom moves across sign-flips: -110 → +110
 * looks like a 220-cent move but is actually 20 cents.
 *
 * This utility maps American odds onto a continuous cent-line where +100
 * and -100 both equal 0, then subtracts on that scale. All HSA juice
 * deltas MUST go through centMove(). Never subtract American odds directly.
 *
 * Do not "simplify" this into a one-liner — the sign-flip behavior is
 * the entire reason this exists. Tests exist to enforce this invariant.
 */

export function toCentLine(americanOdds: number): number {
  if (americanOdds >= 100) return americanOdds - 100;
  if (americanOdds <= -100) return americanOdds + 100;
  throw new Error(
    `Invalid American odds: ${americanOdds}. Odds between -99 and +99 do not exist in American format.`
  );
}

export function centMove(openOdds: number, currentOdds: number): number {
  return toCentLine(currentOdds) - toCentLine(openOdds);
}
