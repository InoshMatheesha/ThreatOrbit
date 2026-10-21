export function relativeTime(iso?: string): string {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.round(diff / 60)} min ago`;
  if (diff < 86_400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86_400)} d ago`;
}

export function dateTime(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : '';
}

export function duration(minutes: number): string {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `~${Math.ceil(minutes)} min`;
  return `~${(minutes / 60).toFixed(1)} h`;
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
