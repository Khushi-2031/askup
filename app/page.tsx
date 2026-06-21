'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { generateSessionId } from '@/lib/utils';

export default function HomePage() {
  const router = useRouter();
  const [tab, setTab] = useState<'host' | 'join'>('join');
  const [title, setTitle] = useState('');
  const [hostName, setHostName] = useState('');
  const [description, setDescription] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function createSession() {
    if (!title.trim()) return setError('Please enter a session title.');
    setLoading(true);
    setError('');
    try {
      const id = generateSessionId();
      const adminToken = crypto.randomUUID();
      const { error: err } = await supabase.from('sessions').insert({
        id,
        title: title.trim(),
        description: description.trim() || null,
        host_name: hostName.trim() || 'Host',
        admin_token: adminToken,
        is_active: true,
      });
      if (err) throw err;
      localStorage.setItem(`askup_admin_${id}`, adminToken);
      router.push(`/admin/${id}?token=${adminToken}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : JSON.stringify(e);
      console.error('[AskUp] createSession error:', msg);
      setError(`Error: ${msg}`);
      setLoading(false);
    }
  }

  async function joinSession() {
    const id = code.trim().toUpperCase();
    if (!id) return setError('Please enter a session code.');
    setLoading(true);
    setError('');
    const { data, error: err } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', id)
      .single();
    if (err || !data) {
      setError('Session not found. Double-check the code.');
      setLoading(false);
      return;
    }
    router.push(`/session/${data.id}`);
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="google-bar w-full" />

      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="text-center mb-10">
          {/* AskUp wordmark in Google colors */}
          <div className="flex items-center justify-center gap-0.5 mb-3">
            {['A', 's', 'k', 'U', 'p'].map((char, i) => {
              const colors = ['#4285F4', '#EA4335', '#FBBC05', '#4285F4', '#34A853'];
              return (
                <span
                  key={i}
                  className="text-6xl font-bold leading-none"
                  style={{ color: colors[i] }}
                >
                  {char}
                </span>
              );
            })}
          </div>
          <p className="text-gray-500 text-base mt-2">
            Live question crowdsourcing for{' '}
            <span className="font-medium text-g-dark">Google Connect</span> AMA sessions
          </p>
          <p className="text-gray-400 text-sm mt-1">
            Where every voice counts — not just the loudest one
          </p>
        </div>

        {/* Card */}
        <div className="w-full max-w-sm">
          {/* Tabs */}
          <div className="flex mb-1 bg-gray-100 rounded-2xl p-1">
            {(['join', 'host'] as const).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t); setError(''); }}
                className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  tab === t
                    ? 'bg-white shadow-sm text-g-dark'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'join' ? '💬 Join a Session' : '🎤 Host a Session'}
              </button>
            ))}
          </div>

          <div className="card p-6 mt-2">
            {tab === 'join' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                    Session Code
                  </label>
                  <input
                    className="input text-center text-2xl font-mono tracking-[0.3em] uppercase"
                    placeholder="A B C 1 2 3"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
                    maxLength={6}
                    onKeyDown={(e) => e.key === 'Enter' && joinSession()}
                  />
                  <p className="text-xs text-gray-400 mt-1.5 text-center">
                    Scan the QR code or enter the code displayed in the room
                  </p>
                </div>
                <button
                  className="btn-green w-full"
                  onClick={joinSession}
                  disabled={loading}
                >
                  {loading ? 'Joining…' : 'Join & Ask Questions →'}
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                    Session Title *
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Engineering AMA with Jane Smith"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                    Your Name / Role
                  </label>
                  <input
                    className="input"
                    placeholder="e.g. Jane Smith, PM @ Google"
                    value={hostName}
                    onChange={(e) => setHostName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wide block mb-1.5">
                    Description (optional)
                  </label>
                  <textarea
                    className="input resize-none"
                    placeholder="Topic, context, or anything participants should know"
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
                <button
                  className="btn-primary w-full"
                  onClick={createSession}
                  disabled={loading}
                >
                  {loading ? 'Creating…' : 'Create Session →'}
                </button>
              </div>
            )}

            {error && (
              <div className="mt-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </div>
            )}
          </div>
        </div>

        {/* Feature pills */}
        <div className="flex flex-wrap gap-2 justify-center mt-8 max-w-md">
          {[
            { icon: '🗳️', text: 'Anonymous submissions' },
            { icon: '⬆️', text: 'Democratic upvoting' },
            { icon: '🔍', text: 'Duplicate detection' },
            { icon: '📺', text: 'Projector display mode' },
            { icon: '📥', text: 'Export unanswered Qs' },
          ].map(({ icon, text }) => (
            <span
              key={text}
              className="text-xs bg-blue-50 text-blue-700 px-3 py-1.5 rounded-full font-medium"
            >
              {icon} {text}
            </span>
          ))}
        </div>
      </div>

      <footer className="text-center py-4 text-xs text-gray-400">
        Built for Google Connect · Intern AMA 2026
      </footer>
    </div>
  );
}
