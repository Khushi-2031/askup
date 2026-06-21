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

// Deterministic emoji avatar from voter ID
const EMOJIS = ['🦊','🐧','🦁','🐬','🦋','🐸','🦄','🐺','🦆','🐙','🦅','🐻','🦒','🦓','🐼','🦘','🦜','🦩','🐳','🦝','🐯','🦔','🐨','🦡'];
export function getEmojiFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) & 0xffff;
  }
  return EMOJIS[hash % EMOJIS.length];
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

// Word cloud helpers
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','could','should','may','might','can','i','you','he',
  'she','we','they','it','this','that','what','how','why','when','where',
  'who','which','about','from','as','if','not','by','up','so','my','your',
  'their','our','its','me','him','her','us','them','there','any','all',
  'just','more','also','like','get','got','go','going','know','think','want',
]);

export interface WordFreq { word: string; count: number }

export function getWordCloud(questions: { text: string }[]): WordFreq[] {
  const freq: Record<string, number> = {};
  for (const q of questions) {
    const words = q.text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/);
    for (const w of words) {
      if (w.length < 4 || STOP_WORDS.has(w)) continue;
      freq[w] = (freq[w] ?? 0) + 1;
    }
  }
  return Object.entries(freq)
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}
