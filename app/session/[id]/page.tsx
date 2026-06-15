'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Question, Session } from '@/lib/types';
import { getVoterId, timeAgo } from '@/lib/utils';
import { findSimilarQuestion } from '@/lib/similarity';

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [text, setText] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [similarQ, setSimilarQ] = useState<Question | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState<'top' | 'new'>('top');
  const [notFound, setNotFound] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voterId = typeof window !== 'undefined' ? getVoterId() : '';

  const loadVotedIds = useCallback(() => {
    const stored = localStorage.getItem(`askup_votes_${id}`);
    if (stored) setVotedIds(new Set(JSON.parse(stored)));
  }, [id]);

  const saveVotedId = (qid: string) => {
    setVotedIds((prev) => {
      const next = new Set(prev);
      next.add(qid);
      localStorage.setItem(`askup_votes_${id}`, JSON.stringify([...next]));
      return next;
    });
  };

  const removeVotedId = (qid: string) => {
    setVotedIds((prev) => {
      const next = new Set(prev);
      next.delete(qid);
      localStorage.setItem(`askup_votes_${id}`, JSON.stringify([...next]));
      return next;
    });
  };

  useEffect(() => {
    loadVotedIds();
    async function load() {
      const { data: sess } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', id)
        .single();
      if (!sess) { setNotFound(true); return; }
      setSession(sess);

      const { data: qs } = await supabase
        .from('questions')
        .select('*')
        .eq('session_id', id)
        .order('votes', { ascending: false });
      setQuestions(qs ?? []);
    }
    load();

    const channel = supabase
      .channel(`session-${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${id}` },
        () => {
          supabase
            .from('questions')
            .select('*')
            .eq('session_id', id)
            .order('votes', { ascending: false })
            .then(({ data }) => setQuestions(data ?? []));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, loadVotedIds]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim().length < 10) { setSimilarQ(null); return; }
    debounceRef.current = setTimeout(() => {
      const similar = findSimilarQuestion(text, questions.filter((q) => !q.is_answered));
      setSimilarQ(similar ? (questions.find((q) => q.id === similar.id) ?? null) : null);
    }, 400);
  }, [text, questions]);

  async function submitQuestion() {
    if (!text.trim() || text.trim().length < 5) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('questions').insert({
        session_id: id,
        text: text.trim(),
        author_name: isAnonymous ? null : (authorName.trim() || null),
        is_anonymous: isAnonymous,
        votes: 0,
        is_answered: false,
      });
      if (error) throw error;
      setText('');
      setAuthorName('');
      setSimilarQ(null);
      setShowForm(false);
      setSubmitMsg('Question submitted! 🎉');
      setTimeout(() => setSubmitMsg(''), 3000);
    } catch {
      setSubmitMsg('Failed to submit. Try again.');
    }
    setSubmitting(false);
  }

  async function vote(q: Question) {
    const alreadyVoted = votedIds.has(q.id);
    const result = await supabase.rpc('cast_vote', {
      p_question_id: q.id,
      p_voter_id: voterId,
      p_is_upvote: !alreadyVoted,
    });
    if (!result.error) {
      if (alreadyVoted) {
        removeVotedId(q.id);
        setQuestions((prev) =>
          prev.map((x) => (x.id === q.id ? { ...x, votes: x.votes - 1 } : x))
        );
      } else {
        saveVotedId(q.id);
        setQuestions((prev) =>
          prev.map((x) => (x.id === q.id ? { ...x, votes: x.votes + 1 } : x))
        );
      }
    }
  }

  const sorted = [...questions].sort((a, b) =>
    filter === 'top'
      ? b.votes - a.votes
      : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4">🔍</div>
          <h2 className="text-xl font-semibold text-g-dark">Session not found</h2>
          <p className="text-gray-500 mt-1 text-sm">Check the code and try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-32">
      <div className="google-bar" />

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-bold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full tracking-widest">
                {id}
              </span>
              {session?.is_active ? (
                <span className="text-[11px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
                  LIVE
                </span>
              ) : (
                <span className="text-[11px] text-gray-400">Ended</span>
              )}
            </div>
            <h1 className="font-semibold text-g-dark text-lg leading-tight truncate">
              {session?.title ?? '…'}
            </h1>
            {session?.host_name && (
              <p className="text-xs text-gray-500">with {session.host_name}</p>
            )}
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="btn-primary shrink-0 flex items-center gap-1.5"
          >
            <span className="text-base">+</span> Ask
          </button>
        </div>
        {session?.description && (
          <p className="max-w-2xl mx-auto text-xs text-gray-500 mt-2 px-0.5">
            {session.description}
          </p>
        )}
      </div>

      {/* Success toast */}
      {submitMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-lg animate-fade-in">
          {submitMsg}
        </div>
      )}

      {/* Ask modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="card w-full max-w-lg p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-g-dark text-lg">Ask a Question</h2>
              <button
                onClick={() => { setShowForm(false); setSimilarQ(null); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ×
              </button>
            </div>

            <textarea
              className="input resize-none mb-3"
              placeholder="What do you want to know? Be specific and concise."
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />

            {/* Duplicate warning */}
            {similarQ && (
              <div className="mb-3 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2.5 text-sm">
                <p className="text-yellow-800 font-medium mb-1">
                  ⚠️ Similar question already exists
                </p>
                <p className="text-yellow-700 text-xs mb-2 line-clamp-2">
                  &ldquo;{similarQ.text}&rdquo;
                </p>
                <button
                  onClick={() => {
                    vote(similarQ);
                    setShowForm(false);
                    setText('');
                    setSimilarQ(null);
                    setSubmitMsg('Upvoted the similar question! ⬆️');
                    setTimeout(() => setSubmitMsg(''), 3000);
                  }}
                  className="text-xs font-medium text-yellow-900 underline"
                >
                  Upvote it instead →
                </button>
              </div>
            )}

            <div className="flex gap-3 items-center mb-4">
              <input
                className="input flex-1"
                placeholder="Your name (optional)"
                value={authorName}
                onChange={(e) => setAuthorName(e.target.value)}
                disabled={isAnonymous}
              />
              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <div
                  onClick={() => setIsAnonymous((v) => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${
                    isAnonymous ? 'bg-g-blue' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      isAnonymous ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </div>
                <span className="text-xs text-gray-600 font-medium">Anon</span>
              </label>
            </div>

            <div className="flex gap-2">
              <button
                onClick={submitQuestion}
                disabled={submitting || text.trim().length < 5}
                className="btn-primary flex-1"
              >
                {submitting ? 'Submitting…' : 'Submit Question'}
              </button>
              <button
                onClick={() => { setShowForm(false); setSimilarQ(null); }}
                className="px-4 py-2.5 rounded-full text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Questions list */}
      <div className="max-w-2xl mx-auto w-full px-4 pt-4 space-y-2">
        {/* Sort bar */}
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 font-medium">
            {questions.length} question{questions.length !== 1 ? 's' : ''}
          </p>
          <div className="flex bg-gray-100 rounded-full p-0.5 gap-0.5">
            {(['top', 'new'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${
                  filter === f ? 'bg-white shadow-sm text-g-dark' : 'text-gray-500'
                }`}
              >
                {f === 'top' ? '⬆ Top' : '🕐 New'}
              </button>
            ))}
          </div>
        </div>

        {sorted.length === 0 && (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">💬</div>
            <p className="font-medium text-gray-500">No questions yet</p>
            <p className="text-sm mt-1">Be the first to ask!</p>
          </div>
        )}

        {sorted.map((q, i) => {
          const voted = votedIds.has(q.id);
          return (
            <div
              key={q.id}
              className={`card p-4 flex gap-3 animate-fade-in ${
                q.is_answered ? 'opacity-60' : ''
              }`}
            >
              {/* Rank */}
              {filter === 'top' && i < 3 && !q.is_answered && (
                <div
                  className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
                  style={{
                    backgroundColor:
                      i === 0 ? '#FBBC05' : i === 1 ? '#9AA0A6' : '#CD7F32',
                  }}
                >
                  {i + 1}
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
                <div className="flex items-center gap-3 mt-2">
                  <span className="text-xs text-gray-400">
                    {q.is_anonymous || !q.author_name ? 'Anonymous' : q.author_name}
                  </span>
                  <span className="text-xs text-gray-300">·</span>
                  <span className="text-xs text-gray-400">{timeAgo(q.created_at)}</span>
                  {q.is_answered && (
                    <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">
                      ✓ Answered
                    </span>
                  )}
                </div>
              </div>

              {/* Vote button */}
              <button
                onClick={() => vote(q)}
                className={`vote-btn shrink-0 flex-col self-center ${
                  voted
                    ? 'bg-blue-50 text-g-blue border border-blue-200'
                    : 'bg-gray-50 text-gray-500 border border-gray-100 hover:border-blue-200 hover:text-g-blue'
                }`}
              >
                <span className="text-base leading-none">{voted ? '▲' : '△'}</span>
                <span className="text-xs font-semibold">{q.votes}</span>
              </button>
            </div>
          );
        })}
      </div>

      {/* Floating ask button for mobile */}
      <div className="fixed bottom-6 right-6 z-40 sm:hidden">
        <button
          onClick={() => setShowForm(true)}
          className="w-14 h-14 rounded-full text-white text-2xl shadow-xl flex items-center justify-center"
          style={{ backgroundColor: '#4285F4' }}
        >
          +
        </button>
      </div>
    </div>
  );
}
