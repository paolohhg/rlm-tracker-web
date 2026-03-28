// ══════════════════════════════════════════════════════════════════════════════
//  True Open Engine — Utility Functions
//
//  Small, reusable helpers. No sport-specific logic.
// ══════════════════════════════════════════════════════════════════════════════

import type { MarketSnapshot, MarketDirection, MarketStructure, ConfidenceLabel } from './types';
import { getMaterialMoveThreshold, RELIABILITY_CONFIG } from './config';

// ── MODE consensus (most common value, tiebreak by median) ───────────────────

export function mode(nums: number[]): number {
  if (nums.length === 0) return 0;
  if (nums.length === 1) return nums[0];
  const freq = new Map<number, number>();
  for (const n of nums) freq.set(n, (freq.get(n) || 0) + 1);
  let maxFreq = 0;
  for (const count of freq.values()) if (count > maxFreq) maxFreq = count;
  const candidates = [...freq.entries()].filter(([, c]) => c === maxFreq).map(([v]) => v);
  if (candidates.length === 1) return candidates[0];
  const sorted = [...nums].sort((a, b) => a - b);
  const medianVal = sorted[Math.floor(sorted.length / 2)];
  candidates.sort((a, b) => Math.abs(a - medianVal) - Math.abs(b - medianVal));
  return candidates[0];
}

// ── Weighted Average ─────────────────────────────────────────────────────────

export function weightedAverage(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  let totalWeight = 0;
  let totalValue = 0;
  for (let i = 0; i < values.length; i++) {
    totalWeight += weights[i];
    totalValue += values[i] * weights[i];
  }
  return totalWeight > 0 ? totalValue / totalWeight : 0;
}

// ── Distinct Path Cleanup ────────────────────────────────────────────────────
// Remove consecutive duplicate values from a path.

export function deduplicatePath(path: number[]): number[] {
  if (path.length <= 1) return [...path];
  const result = [path[0]];
  for (let i = 1; i < path.length; i++) {
    if (path[i] !== result[result.length - 1]) {
      result.push(path[i]);
    }
  }
  return result;
}

// ── Path String ──────────────────────────────────────────────────────────────

export function pathToString(path: number[]): string | null {
  const deduped = deduplicatePath(path);
  if (deduped.length < 2) return null;
  return deduped.join(' → ');
}

// ── Market Direction ─────────────────────────────────────────────────────────

export function computeDirection(
  open: number | null,
  current: number | null,
  materialThreshold: number,
): MarketDirection {
  if (open == null || current == null) return 'unknown';
  const move = current - open;
  if (Math.abs(move) < materialThreshold * 0.1) return 'flat'; // less than 10% of material threshold
  return move > 0 ? 'up' : 'down';
}

// ── Market Structure Classification ──────────────────────────────────────────

export function classifyStructure(
  path: number[],
  marketType: string,
  league: string,
): MarketStructure {
  if (path.length < 2) return 'unknown';

  const threshold = getMaterialMoveThreshold(marketType, league);
  const deduped = deduplicatePath(path);
  if (deduped.length < 2) return 'range_bound';

  // Compute direction changes that exceed the material threshold
  const directions: number[] = [];
  for (let i = 1; i < deduped.length; i++) {
    const diff = deduped[i] - deduped[i - 1];
    if (Math.abs(diff) >= threshold) {
      directions.push(Math.sign(diff));
    }
  }

  if (directions.length === 0) return 'range_bound';

  // Count direction changes
  let changes = 0;
  for (let i = 1; i < directions.length; i++) {
    if (directions[i] !== directions[i - 1]) changes++;
  }

  const uniqueDirs = new Set(directions);

  if (uniqueDirs.size === 1) return 'one_way';
  if (changes === 1) return 'reversal';
  if (changes >= 2) {
    // Check if range-bound (oscillating in tight band)
    const range = Math.max(...deduped) - Math.min(...deduped);
    const totalMove = Math.abs(deduped[deduped.length - 1] - deduped[0]);
    if (range > 0 && totalMove / range < 0.3) return 'range_bound';
    return 'whipsaw';
  }

  return 'unknown';
}

// ── Reliability → Confidence Label ───────────────────────────────────────────

export function reliabilityToConfidence(reliability: number): ConfidenceLabel {
  const t = RELIABILITY_CONFIG.THRESHOLDS;
  if (reliability >= t.HIGH) return 'High';
  if (reliability >= t.MODERATE) return 'Moderate';
  if (reliability >= t.LOW) return 'Low';
  return 'Unreliable';
}

// ── Time Bucketing ───────────────────────────────────────────────────────────

/**
 * Group snapshots into time buckets and compute MODE per bucket.
 * Returns ordered path of consensus values over time.
 */
export function buildTimeBucketedPath(
  snapshots: MarketSnapshot[],
  bucketMinutes: number = 30,
): number[] {
  if (snapshots.length === 0) return [];

  const bucketMs = bucketMinutes * 60 * 1000;
  const buckets: Record<number, number[]> = {};

  for (const s of snapshots) {
    if (s.value === 0 || s.value == null) continue;
    const bucket = Math.floor(new Date(s.timestamp).getTime() / bucketMs);
    if (!buckets[bucket]) buckets[bucket] = [];
    buckets[bucket].push(s.value);
  }

  return Object.keys(buckets)
    .map(Number)
    .sort((a, b) => a - b)
    .map(k => mode(buckets[k]));
}
