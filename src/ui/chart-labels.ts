export interface ChartLabel { name: string; routeDistance: number; kind?: 'pass' | 'peak' }

// 11px full-width / 7px narrow ASCII; wide Latin glyphs also need 11px.
export function labelWidth(name: string): number {
  return Array.from(name).reduce((width, char) => width + (/^[\x20-\x7e]$/.test(char) && !/[MW@%]/.test(char) ? 7 : 11), 0);
}

export function layoutChartLabels(labels: ChartLabel[], total: number, width: number) {
  const left = 4, right = width - 4;
  const result = labels.map(label => {
    const textWidth = labelWidth(label.name);
    const x = 36 + Math.max(0, Math.min(total, label.routeDistance)) / (total || 1) * (width - 44);
    return { label, x, textWidth, textX: Math.max(left + textWidth / 2, Math.min(right - textWidth / 2, x)), row: null as number | null };
  });
  const rows: { from: number; to: number }[][] = [[], [], []];
  // Reserve room for passes first, regardless of input order. Keep every marker.
  const priority = [...result].sort((a, b) => Number(a.label.kind === 'peak') - Number(b.label.kind === 'peak') || a.x - b.x);
  for (const item of priority) {
    if (item.textWidth > right - left) continue;
    const from = item.textX - item.textWidth / 2, to = item.textX + item.textWidth / 2;
    const row = rows.findIndex(r => r.every(other => to + 6 <= other.from || from >= other.to + 6));
    if (row >= 0) { item.row = row; rows[row].push({ from, to }); }
  }
  return result;
}
