// The engine knows nothing about mugs or shirts. A design is a genome: an object of numbers between 0 and 1.
// A domain (see src/domains) says which genes exist, how they group into features, and how to draw them.

export const clamp = (v) => Math.max(0, Math.min(1, v));

export function randomGenome(domain) {
  const g = {};
  domain.genes.forEach((k) => (g[k] = Math.random()));
  return g;
}

// Genes owned by a kept feature are copied from the parent unchanged.
export function keptGenes(domain, kept) {
  return new Set(domain.features.filter((f) => kept.has(f.id)).flatMap((f) => f.genes));
}

export function mutate(domain, parent, strength, kept = new Set()) {
  const keep = keptGenes(domain, kept);
  const g = {};
  domain.genes.forEach((k) => {
    g[k] = keep.has(k) ? parent[k] : clamp(parent[k] + (Math.random() * 2 - 1) * strength);
  });
  return g;
}

// The parent stays in the first cell, so a pick never loses what was picked.
export function nextGeneration(domain, parent, strength, kept, count) {
  return [parent, ...Array.from({ length: count - 1 }, () => mutate(domain, parent, strength, kept))];
}

// Take one feature's genes from a donor design and put them on the parent.
export function borrowFeature(domain, parent, donor, featureId) {
  const f = domain.features.find((x) => x.id === featureId);
  const g = { ...parent };
  f.genes.forEach((k) => (g[k] = donor[k]));
  return g;
}

// Average gene-by-gene difference. Zero means identical. The Study team's target task uses this.
export function distance(domain, a, b) {
  return domain.genes.reduce((sum, k) => sum + Math.abs(a[k] - b[k]), 0) / domain.genes.length;
}

// A feature is "steady" when its genes barely moved over the last three picks: a hint that it is worth keeping.
export function isSteady(feature, trail) {
  if (trail.length < 3) return false;
  const [a, b, c] = trail.slice(-3);
  return feature.genes.every((k) => Math.abs(a[k] - c[k]) < 0.07 && Math.abs(b[k] - c[k]) < 0.07);
}

// A chip shows a plain neutral design wearing ONE feature from the parent.
export function featureSample(domain, feature, parent) {
  const g = { ...domain.neutral };
  if (parent) [...feature.genes, ...(feature.show || [])].forEach((k) => (g[k] = parent[k]));
  return g;
}

// Repeatable random numbers for one genome, so a tile's speckle or pattern never flickers between redraws.
export function seeded(domain, g) {
  let s = Math.floor(domain.genes.reduce((a, k, i) => a + g[k] * (i + 3) * 7919, 1)) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export const pick = (v, words) => words[Math.min(words.length - 1, Math.floor(v * words.length))];
