'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '@/lib/supabase';
import { Question, Session } from '@/lib/types';
import { downloadCSV, timeAgo } from '@/lib/utils';

export default function AdminPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';

  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [unauthorized, setUnauthorized] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unanswered' | 'answered'>('unanswered');
  const [participantUrl, setParticipantUrl] = useState('');
  const [displayUrl, setDisplayUrl] = useState('');
  const [copyMsg, setCopyMsg] = useState('');

  const loadQuestions = useCallback(async () => {
    const { data } = await supabase
      .from('questions')
      .select('*')
      .eq('session_id', id)
      .order('votes', { ascending: false });
    setQuestions(data ?? []);
  }, [id]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const base = window.location.origin;
      setParticipantUrl(`${base}/session/${id}`);
      setDisplayUrl(`${base}/display/${id}`);
    }
    async function init() {
      const { data: sess } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();
      if (!sess) { setUnauthorized(true); return; }
      if (sess.admin_token !== token) { setUnauthorized(true); return; }
      setSession(sess);
      await loadQuestions();
    }
    init();

    const channel = supabase
      .channel(`admin-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${id}` },
        loadQuestions
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, token, loadQuestions]);

  async function markAnswered(q: Question) {
    await supabase
      .from('questions')
      .update({ is_answered: !q.is_answered })
      .eq('id', q.id);
    setQuestions((prev) =>
      prev.map((x) => (x.id === q.id ? { ...x, is_answered: !q.is_answered } : x))
    );
  }

  async function deleteQuestion(qid: string) {
    if (!confirm('Delete this question?')) return;
    await supabase.from('questions').delete().eq('id', qid);
    setQuestions((prev) => prev.filter((q) => q.id !== qid));
  }

  async function toggleSession() {
    if (!session) return;
    const next = !session.is_active;
    await supabase.from('sessions').update({ is_active: next }).eq('id', id);
    setSession({ ...session, is_active: next });
  }

  function exportUnanswered() {
    const rows = questions
      .filter((q) => !q.is_answered)
      .sort((a, b) => b.votes - a.votes)
      .map((q) => [
        q.text,
        q.is_anonymous || !q.author_name ? 'Anonymous' : q.author_name,
        String(q.votes),
        new Date(q.created_at).toLocaleString(),
      ]);
    downloadCSV(
      [['Question', 'Author', 'Votes', 'Submitted At'], ...rows],
      `askup-${id}-unanswered.csv`
    );
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url);
    setCopyMsg('Copied!');
    setTimeout(() => setCopyMsg(''), 2000);
  }

  const filtered = questions.filter((q) =>
    filter === 'all' ? true : filter === 'unanswered' ? !q.is_answered : q.is_answered
  );
  const unansweredCount = questions.filter((q) => !q.is_answered).length;
  const answeredCount = questions.filter((q) => q.is_answered).length;

  if (unauthorized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">🔒</div>
          <h2 className="text-xl font-semibold text-g-dark">Access Denied</h2>
          <p className="text-gray-500 mt-1 text-sm">Invalid session or admin token.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="google-bar" />

      {/* Header */}
      <div className="bg-white border-b border-gray-100 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                  ADMIN
                </span>
                <span className="text-xs font-bold bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full tracking-widest">
                  {id}
                </span>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full flex items-center gap-1 ${
                    session?.is_active
                      ? 'bg-green-50 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full inline-block ${
                      session?.is_active ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                    }`}
                  />
                  {session?.is_active ? 'LIVE' : 'ENDED'}
                </span>
              </div>
              <h1 className="text-xl font-semibold text-g-dark">{session?.title ?? '…'}</h1>
              {session?.host_name && (
                <p className="text-sm text-gray-500">Hosted by {session.host_name}</p>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              <button
                onClick={() => setShowQR(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
              >
                📱 QR Code
              </button>
              <a
                href={displayUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
              >
                📺 Projector
              </a>
              <button
                onClick={exportUnanswered}
                className="flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium border border-gray-200 bg-white hover:bg-gray-50 text-gray-700"
              >
                📥 Export
              </button>
              <button
                onClick={toggleSession}
                className={`px-3 py-2 rounded-full text-sm font-medium text-white ${
                  session?.is_active ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'
                }`}
              >
                {session?.is_active ? 'End Session' : 'Resume Session'}
              </button>
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-4 mt-4">
            {[
              { label: 'Total Questions', val: questions.length, color: '#4285F4' },
              { label: 'Unanswered', val: unansweredCount, color: '#EA4335' },
              { label: 'Answered', val: answeredCount, color: '#34A853' },
              {
                label: 'Top Votes',
                val: questions[0]?.votes ?? 0,
                color: '#FBBC05',
              },
            ].map(({ label, val, color }) => (
              <div key={label} className="text-center">
                <div className="text-2xl font-bold" style={{ color }}>
                  {val}
                </div>
                <div className="text-xs text-gray-500">{label}</div>
              </div>
            ))}
          </div>

          {/* Participant link */}
          <div className="mt-3 flex items-center gap-2 bg-blue-50 rounded-xl px-3 py-2">
            <span className="text-xs text-blue-700 font-medium flex-1 truncate">
              {participantUrl}
            </span>
            <button
              onClick={() => copyLink(participantUrl)}
              className="text-xs font-semibold text-blue-600 shrink-0"
            >
              {copyMsg || 'Copy link'}
            </button>
          </div>
        </div>
      </div>

      {/* QR Modal */}
      {showQR && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowQR(false)}
        >
          <div
            className="card p-8 text-center max-w-xs w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-g-dark mb-1">Scan to Join</h3>
            <p className="text-xs text-gray-500 mb-5">
              Ask &amp; vote on questions live
            </p>
            <div className="flex justify-center mb-5">
              <QRCodeSVG
                value={participantUrl}
                size={200}
                fgColor="#202124"
                bgColor="#ffffff"
                level="M"
              />
            </div>
            <div className="bg-gray-50 rounded-xl py-3 px-4 mb-4">
              <p className="text-xs text-gray-500 mb-1">or enter code at askup.vercel.app</p>
              <p className="text-3xl font-bold tracking-[0.3em] text-g-dark font-mono">{id}</p>
            </div>
            <button
              onClick={() => setShowQR(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Questions */}
      <div className="max-w-4xl mx-auto px-4 py-4">
        {/* Filter tabs */}
        <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 mb-4 w-fit">
          {(['unanswered', 'all', 'answered'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-xl text-sm font-medium transition-all capitalize ${
                filter === f ? 'bg-white shadow-sm text-g-dark' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {f === 'unanswered' ? `Unanswered (${unansweredCount})` : f === 'answered' ? `Answered (${answeredCount})` : `All (${questions.length})`}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {filtered.length === 0 && (
            <div className="text-center py-16 text-gray-400">
              <div className="text-4xl mb-3">
                {filter === 'answered' ? '✅' : '💬'}
              </div>
              <p className="font-medium text-gray-500">
                {filter === 'answered' ? 'No answered questions yet' : 'No questions yet'}
              </p>
            </div>
          )}
          {filtered.map((q, i) => (
            <div
              key={q.id}
              className={`card p-4 flex gap-3 ${
                q.is_answered ? 'opacity-60 border-green-100' : ''
              }`}
            >
              {/* Rank badge */}
              {i < 3 && !q.is_answered && filter !== 'answered' && (
                <div
                  className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
                  style={{
                    backgroundColor:
                      i === 0 ? '#FBBC05' : i === 1 ? '#9AA0A6' : '#CD7F32',
                  }}
                >
                  #{i + 1}
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p
                  className={`text-sm leading-relaxed ${
                    q.is_answered ? 'line-through text-gray-400' : 'text-g-dark'
                  }`}
                >
                  {q.text}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-xs text-gray-500 font-medium">
                    {q.is_anonymous || !q.author_name ? '👤 Anonymous' : `👤 ${q.author_name}`}
                  </span>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-gray-400">{timeAgo(q.created_at)}</span>
                  {q.is_answered && (
                    <span className="text-xs font-medium text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">
                      ✓ Answered
                    </span>
                  )}
                </div>
              </div>

              {/* Vote count */}
              <div className="flex flex-col items-center shrink-0 gap-3">
                <div
                  className="flex flex-col items-center px-3 py-2 rounded-xl min-w-[44px]"
                  style={{ backgroundColor: '#EEF4FF' }}
                >
                  <span className="text-xs font-bold" style={{ color: '#4285F4' }}>
                    ▲
                  </span>
                  <span className="text-base font-bold" style={{ color: '#4285F4' }}>
                    {q.votes}
                  </span>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => markAnswered(q)}
                    title={q.is_answered ? 'Mark unanswered' : 'Mark answered'}
                    className={`p-1.5 rounded-lg text-sm transition-colors ${
                      q.is_answered
                        ? 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        : 'bg-green-50 text-green-600 hover:bg-green-100'
                    }`}
                  >
                    {q.is_answered ? '↩' : '✓'}
                  </button>
                  <button
                    onClick={() => deleteQuestion(q.id)}
                    title="Delete question"
                    className="p-1.5 rounded-lg text-sm bg-red-50 text-red-400 hover:bg-red-100 transition-colors"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
