import type { Sample } from './elevation';
export interface GradeBin { from: number; to: number; grade: number | null }
export function elevationAt(samples: Pick<Sample, 'distance' | 'ele'>[], d: number): number | null {
  if (!samples.length) return null;
  let lo = 0, hi = samples.length - 1;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (samples[mid].distance < d) lo = mid + 1; else hi = mid; }
  const b = samples[lo], a = samples[Math.max(0, lo - 1)];
  if (b.distance === d) return b.ele;
  if (a.ele === null || b.ele === null) return null;
  return b.distance === a.distance ? b.ele : a.ele + (b.ele - a.ele) * (d - a.distance) / (b.distance - a.distance);
}
/** Fixed distance bins. Missing samples or interpolation support leave a gap. */
export function gradeBins(samples: Pick<Sample, 'distance' | 'ele'>[], binM = 500): GradeBin[] {
  if (!(binM > 0) || !Number.isFinite(binM)) throw new Error('Bin size must be positive and finite');
  const bins: GradeBin[] = [], total = samples.at(-1)?.distance ?? 0;
  let i = 0;
  for (let from = samples[0]?.distance ?? 0; from < total; from += binM) {
    const to = Math.min(total, from + binM), a = elevationAt(samples, from), b = elevationAt(samples, to);
    let missing = a === null || b === null;
    while (i < samples.length && samples[i].distance <= to) {
      if (samples[i].distance >= from && (samples[i].ele === null || !Number.isFinite(samples[i].ele))) missing = true;
      i++;
    }
    bins.push({ from, to, grade: missing ? null : (b! - a!) / (to - from) * 100 });
  }
  return bins;
}
export function gradeColor(grade: number | null) {
  return grade === null ? 'none' : `var(--g${grade < 0 ? 'down' : grade < 3 ? '0' : grade < 6 ? '3' : grade < 9 ? '6' : grade < 12 ? '9' : '12'})`;
}
