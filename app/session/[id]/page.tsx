'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Question, Session } from '@/lib/types';
import { getVoterId, getEmojiFromId, timeAgo } from '@/lib/utils';
import { findSimilarQuestion } from '@/lib/similarity';

export default function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [meTooIds, setMeTooIds] = useState<Set<string>>(new Set());
  const [ratedIds, setRatedIds] = useState<Set<string>>(new Set());
  const [myQuestionIds, setMyQuestionIds] = useState<Set<string>>(new Set());
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
  const myEmoji = voterId ? getEmojiFromId(voterId) : '🙂';

  const loadLocal = useCallback(() => {
    const votes = localStorage.getItem(`askup_votes_${id}`);
    if (votes) setVotedIds(new Set(JSON.parse(votes)));
    const meToo = localStorage.getItem(`askup_metoo_${id}`);
    if (meToo) setMeTooIds(new Set(JSON.parse(meToo)));
    const rated = localStorage.getItem(`askup_rated_${id}`);
    if (rated) setRatedIds(new Set(JSON.parse(rated)));
    const mine = localStorage.getItem(`askup_mine_${id}`);
    if (mine) setMyQuestionIds(new Set(JSON.parse(mine)));
  }, [id]);

  useEffect(() => {
    loadLocal();
    async function load() {
      const { data: sess } = await supabase.from('sessions').select('*').eq('id', id).single();
      if (!sess) { setNotFound(true); return; }
      setSession(sess);
      const { data: qs } = await supabase
        .from('questions').select('*').eq('session_id', id).order('votes', { ascending: false });
      setQuestions(qs ?? []);
    }
    load();

    const channel = supabase
      .channel(`session-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${id}` },
        () => {
          supabase.from('questions').select('*').eq('session_id', id).order('votes', { ascending: false })
            .then(({ data }) => setQuestions(data ?? []));
        })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [id, loadLocal]);

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
      const emoji = getEmojiFromId(voterId);
      const { data, error } = await supabase.from('questions').insert({
        session_id: id,
        text: text.trim(),
        author_name: isAnonymous ? null : (authorName.trim() || null),
        author_emoji: emoji,
        voter_id: voterId,
        is_anonymous: isAnonymous,
        votes: 0,
        me_too_count: 0,
        is_answered: false,
      }).select().single();
      if (error) throw error;
      // Track my questions
      if (data) {
        setMyQuestionIds((prev) => {
          const next = new Set(prev);
          next.add(data.id);
          localStorage.setItem(`askup_mine_${id}`, JSON.stringify([...next]));
          return next;
        });
      }
      setText(''); setAuthorName(''); setSimilarQ(null); setShowForm(false);
      setSubmitMsg('Question submitted! 🎉');
      setTimeout(() => setSubmitMsg(''), 3000);
    } catch (e: unknown) {
      setSubmitMsg(e instanceof Error ? e.message : 'Failed to submit.');
    }
    setSubmitting(false);
  }

  async function vote(q: Question) {
    const alreadyVoted = votedIds.has(q.id);
    const result = await supabase.rpc('cast_vote', { p_question_id: q.id, p_voter_id: voterId, p_is_upvote: !alreadyVoted });
    if (!result.error) {
      if (alreadyVoted) {
        setVotedIds((prev) => { const n = new Set(prev); n.delete(q.id); localStorage.setItem(`askup_votes_${id}`, JSON.stringify([...n])); return n; });
        setQuestions((prev) => prev.map((x) => x.id === q.id ? { ...x, votes: x.votes - 1 } : x));
      } else {
        setVotedIds((prev) => { const n = new Set(prev); n.add(q.id); localStorage.setItem(`askup_votes_${id}`, JSON.stringify([...n])); return n; });
        setQuestions((prev) => prev.map((x) => x.id === q.id ? { ...x, votes: x.votes + 1 } : x));
      }
    }
  }

  async function meToo(q: Question) {
    if (myQuestionIds.has(q.id)) return; // can't me-too own question
    const already = meTooIds.has(q.id);
    const result = await supabase.rpc('cast_me_too', { p_question_id: q.id, p_voter_id: voterId, p_is_add: !already });
    if (!result.error) {
      if (already) {
        setMeTooIds((prev) => { const n = new Set(prev); n.delete(q.id); localStorage.setItem(`askup_metoo_${id}`, JSON.stringify([...n])); return n; });
        setQuestions((prev) => prev.map((x) => x.id === q.id ? { ...x, me_too_count: Math.max(0, (x.me_too_count ?? 0) - 1) } : x));
      } else {
        setMeTooIds((prev) => { const n = new Set(prev); n.add(q.id); localStorage.setItem(`askup_metoo_${id}`, JSON.stringify([...n])); return n; });
        setQuestions((prev) => prev.map((x) => x.id === q.id ? { ...x, me_too_count: (x.me_too_count ?? 0) + 1 } : x));
      }
    }
  }

  async function rateSatisfaction(q: Question, isPositive: boolean) {
    if (ratedIds.has(q.id)) return;
    await supabase.rpc('cast_satisfaction', { p_question_id: q.id, p_voter_id: voterId, p_is_positive: isPositive });
    setRatedIds((prev) => { const n = new Set(prev); n.add(q.id); localStorage.setItem(`askup_rated_${id}`, JSON.stringify([...n])); return n; });
    setQuestions((prev) => prev.map((x) => x.id === q.id ? { ...x, [isPositive ? 'satisfaction_up' : 'satisfaction_down']: (x[isPositive ? 'satisfaction_up' : 'satisfaction_down'] ?? 0) + 1 } : x));
    setSubmitMsg(isPositive ? 'Thanks for the feedback! 👍' : 'Noted, thanks! 👎');
    setTimeout(() => setSubmitMsg(''), 2500);
  }

  const sorted = [...questions].sort((a, b) =>
    filter === 'top' ? b.votes - a.votes : new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  if (notFound) return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center"><div className="text-5xl mb-4">🔍</div>
        <h2 className="text-xl font-semibold text-g-dark">Session not found</h2>
        <p className="text-gray-500 mt-1 text-sm">Check the code and try again.</p>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-32">
      <div className="google-bar" />

      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10 shadow-sm">
        <div className="max-w-2xl mx-auto flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-bold bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full tracking-widest">{id}</span>
              {session?.is_active ? (
                <span className="text-[11px] font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />LIVE
                </span>
              ) : <span className="text-[11px] text-gray-400">Ended</span>}
            </div>
            <h1 className="font-semibold text-g-dark text-lg leading-tight truncate">{session?.title ?? '…'}</h1>
            {session?.host_name && <p className="text-xs text-gray-500">with {session.host_name}</p>}
          </div>
          <button onClick={() => setShowForm(true)} className="btn-primary shrink-0 flex items-center gap-1.5">
            <span className="text-base">+</span> Ask
          </button>
        </div>
        {session?.description && <p className="max-w-2xl mx-auto text-xs text-gray-500 mt-2">{session.description}</p>}
        {/* My emoji identity */}
        <div className="max-w-2xl mx-auto mt-2 flex items-center gap-1.5">
          <span className="text-base">{myEmoji}</span>
          <span className="text-xs text-gray-400">You are <strong className="text-gray-500">{myEmoji}</strong> this session</span>
        </div>
      </div>

      {/* Toast */}
      {submitMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-5 py-2.5 rounded-full shadow-lg">
          {submitMsg}
        </div>
      )}

      {/* Ask modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="card w-full max-w-lg p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{myEmoji}</span>
                <h2 className="font-semibold text-g-dark text-lg">Ask a Question</h2>
              </div>
              <button onClick={() => { setShowForm(false); setSimilarQ(null); }} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <textarea className="input resize-none mb-3" placeholder="What do you want to know? Be specific and concise."
              rows={4} value={text} onChange={(e) => setText(e.target.value)} autoFocus />

            {similarQ && (
              <div className="mb-3 bg-yellow-50 border border-yellow-200 rounded-xl px-3 py-2.5 text-sm">
                <p className="text-yellow-800 font-medium mb-1">⚠️ Similar question already exists</p>
                <p className="text-yellow-700 text-xs mb-2 line-clamp-2">&ldquo;{similarQ.text}&rdquo;</p>
                <div className="flex gap-3">
                  <button onClick={() => { vote(similarQ); setShowForm(false); setText(''); setSimilarQ(null); setSubmitMsg('Upvoted ⬆️'); setTimeout(() => setSubmitMsg(''), 3000); }}
                    className="text-xs font-medium text-yellow-900 underline">▲ Upvote it instead</button>
                  <button onClick={() => { meToo(similarQ); setShowForm(false); setText(''); setSimilarQ(null); setSubmitMsg('Added Me Too 🙋'); setTimeout(() => setSubmitMsg(''), 3000); }}
                    className="text-xs font-medium text-yellow-900 underline">🙋 Me Too instead</button>
                </div>
              </div>
            )}

            <div className="flex gap-3 items-center mb-4">
              <input className="input flex-1" placeholder="Your name (optional)" value={authorName}
                onChange={(e) => setAuthorName(e.target.value)} disabled={isAnonymous} />
              <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                <div onClick={() => setIsAnonymous((v) => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative ${isAnonymous ? 'bg-g-blue' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${isAnonymous ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-xs text-gray-600 font-medium">Anon</span>
              </label>
            </div>
            {isAnonymous && (
              <p className="text-xs text-gray-400 -mt-2 mb-3 ml-1">Your emoji <strong>{myEmoji}</strong> stays visible so you can find your question</p>
            )}

            <div className="flex gap-2">
              <button onClick={submitQuestion} disabled={submitting || text.trim().length < 5} className="btn-primary flex-1">
                {submitting ? 'Submitting…' : 'Submit Question'}
              </button>
              <button onClick={() => { setShowForm(false); setSimilarQ(null); }}
                className="px-4 py-2.5 rounded-full text-sm font-medium text-gray-600 border border-gray-200 hover:bg-gray-50">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Questions */}
      <div className="max-w-2xl mx-auto w-full px-4 pt-4 space-y-2">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 font-medium">{questions.length} question{questions.length !== 1 ? 's' : ''}</p>
          <div className="flex bg-gray-100 rounded-full p-0.5 gap-0.5">
            {(['top', 'new'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${filter === f ? 'bg-white shadow-sm text-g-dark' : 'text-gray-500'}`}>
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
          const meTood = meTooIds.has(q.id);
          const rated = ratedIds.has(q.id);
          const isMyQ = myQuestionIds.has(q.id);
          const displayEmoji = q.author_emoji ?? (q.voter_id ? getEmojiFromId(q.voter_id) : '👤');

          return (
            <div key={q.id} className={`card p-4 animate-fade-in ${q.is_answered ? 'opacity-70' : ''} ${isMyQ ? 'ring-2 ring-blue-200' : ''}`}>
              <div className="flex gap-3">
                {/* Rank */}
                {filter === 'top' && i < 3 && !q.is_answered && (
                  <div className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white mt-0.5"
                    style={{ backgroundColor: i === 0 ? '#FBBC05' : i === 1 ? '#9AA0A6' : '#CD7F32' }}>
                    {i + 1}
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p className={`text-sm leading-relaxed ${q.is_answered ? 'line-through text-gray-400' : 'text-g-dark'}`}>
                    {q.text}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-base">{displayEmoji}</span>
                    <span className="text-xs text-gray-400">
                      {q.is_anonymous || !q.author_name ? 'Anonymous' : q.author_name}
                      {isMyQ && <span className="ml-1 text-blue-500 font-medium">· you</span>}
                    </span>
                    <span className="text-xs text-gray-300">·</span>
                    <span className="text-xs text-gray-400">{timeAgo(q.created_at)}</span>
                    {q.is_answered && <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded-full">✓ Answered</span>}
                  </div>

                  {/* Satisfaction rating (only for answered questions, only if not yet rated) */}
                  {q.is_answered && !rated && !isMyQ && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-400">Was this answered well?</span>
                      <button onClick={() => rateSatisfaction(q, true)}
                        className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 font-medium">👍</button>
                      <button onClick={() => rateSatisfaction(q, false)}
                        className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500 border border-red-200 hover:bg-red-100 font-medium">👎</button>
                    </div>
                  )}
                  {q.is_answered && rated && (
                    <p className="text-xs text-gray-400 mt-1">
                      {(q.satisfaction_up ?? 0) + (q.satisfaction_down ?? 0) > 0
                        ? `${Math.round(((q.satisfaction_up ?? 0) / Math.max((q.satisfaction_up ?? 0) + (q.satisfaction_down ?? 0), 1)) * 100)}% found this satisfying`
                        : 'Thanks for rating!'}
                    </p>
                  )}
                </div>

                {/* Vote + Me Too */}
                <div className="flex flex-col gap-1.5 shrink-0 self-start">
                  <button onClick={() => vote(q)}
                    className={`vote-btn flex-col ${voted ? 'bg-blue-50 text-g-blue border border-blue-200' : 'bg-gray-50 text-gray-500 border border-gray-100 hover:border-blue-200 hover:text-g-blue'}`}>
                    <span className="text-base leading-none">{voted ? '▲' : '△'}</span>
                    <span className="text-xs font-semibold">{q.votes}</span>
                  </button>
                  {!isMyQ && !q.is_answered && (
                    <button onClick={() => meToo(q)}
                      title="I have this question too"
                      className={`vote-btn flex-col ${meTood ? 'bg-purple-50 text-purple-600 border border-purple-200' : 'bg-gray-50 text-gray-400 border border-gray-100 hover:border-purple-200 hover:text-purple-500'}`}>
                      <span className="text-sm leading-none">🙋</span>
                      <span className="text-xs font-semibold">{q.me_too_count ?? 0}</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* FAB */}
      <div className="fixed bottom-6 right-6 z-40 sm:hidden">
        <button onClick={() => setShowForm(true)}
          className="w-14 h-14 rounded-full text-white text-2xl shadow-xl flex items-center justify-center"
          style={{ backgroundColor: '#4285F4' }}>+</button>
      </div>
    </div>
  );
}
