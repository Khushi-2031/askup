const STOP_WORDS = new Set([
  'what', 'when', 'where', 'how', 'why', 'who', 'will', 'can', 'do', 'does',
  'is', 'are', 'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
  'for', 'of', 'with', 'as', 'your', 'you', 'about', 'any', 'there', 'would',
  'could', 'should', 'have', 'has', 'had', 'been', 'be', 'this', 'that',
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

export const SIMILARITY_THRESHOLD = 0.38;

export function findSimilarQuestion(
  newText: string,
  existing: Array<{ id: string; text: string }>
): { id: string; text: string } | null {
  let best: { id: string; text: string } | null = null;
  let bestScore = SIMILARITY_THRESHOLD;
  for (const q of existing) {
    const score = jaccardSimilarity(newText, q.text);
    if (score > bestScore) {
      bestScore = score;
      best = q;
    }
  }
  return best;
}
