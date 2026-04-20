/**
 * HSA Principles — shared types.
 *
 * Structural invariant: every principle lives in exactly one file. Principle
 * files do NOT import from each other. Slot prompts (downstream, not in this
 * brief) assemble principles by importing from multiple files via index.ts.
 */

export type PrincipleBucket = 'universal' | 'market' | 'sport';

export type Principle = {
  id: string;
  bucket: PrincipleBucket;
  title: string;
  body: string;
  last_validated: string;
  tags?: string[];
};
