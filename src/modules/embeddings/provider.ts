export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  constructor(private readonly dimensions = 12) {}

  async embed(text: string): Promise<number[]> {
    const vector = new Array<number>(this.dimensions).fill(0);
    const tokens = text.toLowerCase().match(/[a-z0-9_./-]+/g) ?? [];

    for (const token of tokens) {
      const hash = this.hash(token);
      const slot = Math.abs(hash) % this.dimensions;
      vector[slot] = (vector[slot] ?? 0) + 1 + (token.length % 7) / 10;
    }

    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    return magnitude === 0 ? vector : vector.map((value) => Number((value / magnitude).toFixed(6)));
  }

  private hash(value: string): number {
    let hash = 0;
    for (let index = 0; index < value.length; index += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(index);
      hash |= 0;
    }
    return hash;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const aValue = a[index] ?? 0;
    const bValue = b[index] ?? 0;
    dot += aValue * bValue;
    magnitudeA += aValue * aValue;
    magnitudeB += bValue * bValue;
  }

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dot / Math.sqrt(magnitudeA * magnitudeB);
}
