const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateSessionId(): string {
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return id;
}

export function getVoterId(): string {
  if (typeof window === 'undefined') return '';
  let id = localStorage.getItem('askup_voter_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('askup_voter_id', id);
  }
  return id;
}

export function downloadCSV(rows: string[][], filename: string) {
  const content = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
