/**
 * Principle types for the HSA principles foundation.
 *
 * STRUCTURAL INVARIANT: Every principle lives in exactly one file. No imports
 * between principle files. Slot prompts (future work) import from multiple
 * principle files; principle files do not import from each other.
 */

export type PrincipleBucket = 'universal' | 'market' | 'sport';

export type Principle = {
  id: string;              // e.g., "U1", "S3", "NHL3"
  bucket: PrincipleBucket;
  title: string;           // short name, e.g., "Closing line is best estimate"
  body: string;            // full principle text, multi-line
  last_validated: string;  // ISO date, e.g., "2026-04-19"
  tags?: string[];         // optional, e.g., ["juice", "stuck-line"]
};
