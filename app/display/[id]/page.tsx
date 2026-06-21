'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Question, Session } from '@/lib/types';
import { getWordCloud } from '@/lib/utils';

type ViewMode = 'single' | 'queue' | 'wordcloud';

const GOOGLE_COLORS = ['#4285F4', '#EA4335', '#FBBC05', '#34A853', '#4285F4', '#EA4335'];

export default function DisplayPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [displayIndex, setDisplayIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [view, setView] = useState<ViewMode>('single');

  const loadQuestions = useCallback(async () => {
    const { data: unanswered } = await supabase
      .from('questions').select('*').eq('session_id', id).eq('is_answered', false).order('votes', { ascending: false });
    setQuestions(unanswered ?? []);
    const { data: all } = await supabase
      .from('questions').select('*').eq('session_id', id).order('votes', { ascending: false });
    setAllQuestions(all ?? []);
  }, [id]);

  useEffect(() => {
    async function init() {
      const { data: sess } = await supabase.from('sessions').select('*').eq('id', id).single();
      setSession(sess);
      await loadQuestions();
    }
    init();
    const channel = supabase.channel(`display-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${id}` }, loadQuestions)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, loadQuestions]);

  useEffect(() => {
    setDisplayIndex((prev) => questions.length > 0 ? Math.min(prev, questions.length - 1) : 0);
  }, [questions.length]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) { document.documentElement.requestFullscreen(); setIsFullscreen(true); }
    else { document.exitFullscreen(); setIsFullscreen(false); }
  }

  const current = questions[displayIndex];
  const topQuestions = questions.slice(0, 10);
  const wordCloud = getWordCloud(allQuestions);
  const maxCount = wordCloud[0]?.count ?? 1;

  if (!session) return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-white text-xl animate-pulse">Loading…</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col select-none">
      <div className="google-bar w-full" />

      {/* Controls */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900/80">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5">
            {['A','s','k','U','p'].map((c, i) => (
              <span key={i} className="text-xl font-bold" style={{ color: GOOGLE_COLORS[i] }}>{c}</span>
            ))}
          </div>
          <span className="text-gray-500 text-sm">·</span>
          <span className="text-sm text-gray-300 font-medium truncate max-w-xs">{session.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{questions.length} pending</span>
          {/* View switcher */}
          <div className="flex bg-gray-800 rounded-full p-0.5 gap-0.5">
            {([['single','📋'],['queue','📊'],['wordcloud','☁️']] as [ViewMode, string][]).map(([v, icon]) => (
              <button key={v} onClick={() => setView(v)}
                className={`text-xs px-3 py-1 rounded-full font-medium transition-all ${view === v ? 'bg-gray-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                {icon} {v === 'single' ? 'Focus' : v === 'queue' ? 'Queue' : 'Cloud'}
              </button>
            ))}
          </div>
          <button onClick={toggleFullscreen}
            className="text-xs px-3 py-1.5 rounded-full bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium">
            {isFullscreen ? '⊠ Exit' : '⊞ Full'}
          </button>
        </div>
      </div>

      {/* Word Cloud view */}
      {view === 'wordcloud' && (
        <div className="flex-1 flex flex-col items-center justify-center px-8 py-6">
          <h2 className="text-gray-400 text-sm uppercase tracking-widest mb-8 font-medium">What the room is thinking</h2>
          {wordCloud.length === 0 ? (
            <p className="text-gray-600 text-xl">No questions yet — the cloud will fill as people ask!</p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-4 justify-center items-center max-w-5xl">
              {wordCloud.map(({ word, count }, i) => {
                const ratio = count / maxCount;
                const size = 1 + ratio * 3.5; // 1rem to 4.5rem
                const color = GOOGLE_COLORS[i % GOOGLE_COLORS.length];
                const opacity = 0.4 + ratio * 0.6;
                return (
                  <span key={word} style={{ fontSize: `${size}rem`, color, opacity, fontWeight: ratio > 0.5 ? 700 : 500, lineHeight: 1.1 }}>
                    {word}
                  </span>
                );
              })}
            </div>
          )}
          <p className="text-gray-700 text-xs mt-8">Updates live as questions come in · {allQuestions.length} total questions</p>
        </div>
      )}

      {/* Queue view */}
      {view === 'queue' && (
        <div className="flex-1 px-8 py-6 overflow-auto">
          <h2 className="text-xl font-semibold text-gray-300 mb-4">Top Questions Queue</h2>
          <div className="space-y-3 max-w-4xl mx-auto">
            {topQuestions.map((q, i) => (
              <div key={q.id}
                className={`rounded-2xl p-4 flex gap-4 items-center cursor-pointer transition-all ${i === displayIndex ? 'ring-2 ring-blue-400 bg-gray-800' : 'bg-gray-900 hover:bg-gray-800'}`}
                onClick={() => { setDisplayIndex(i); setView('single'); }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold shrink-0"
                  style={{ backgroundColor: i === 0 ? '#FBBC05' : i === 1 ? '#9AA0A6' : i === 2 ? '#CD7F32' : '#374151', color: i <= 2 ? '#000' : '#fff' }}>
                  {i + 1}
                </div>
                <p className="text-base text-gray-100 flex-1">{q.text}</p>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="flex items-center gap-1">
                    <span className="text-blue-400 text-sm">▲</span>
                    <span className="text-xl font-bold text-blue-300">{q.votes}</span>
                  </div>
                  {(q.me_too_count ?? 0) > 0 && (
                    <span className="text-xs text-purple-400 font-medium">🙋 {q.me_too_count}</span>
                  )}
                </div>
              </div>
            ))}
            {topQuestions.length === 0 && (
              <div className="text-center py-12 text-gray-600">
                <div className="text-4xl mb-3">💬</div><p>No questions yet</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Single focus view */}
      {view === 'single' && (
        <div className="flex-1 flex flex-col items-center justify-center px-10 py-8">
          {current ? (
            <>
              <div className="w-full max-w-4xl">
                <div className="flex items-center gap-3 mb-6 flex-wrap">
                  <div className="flex items-center gap-2 bg-blue-600/20 border border-blue-500/30 rounded-full px-4 py-2">
                    <span className="text-blue-300 text-lg">▲</span>
                    <span className="text-3xl font-bold text-blue-300">{current.votes}</span>
                    <span className="text-blue-400 text-sm font-medium">votes</span>
                  </div>
                  {(current.me_too_count ?? 0) > 0 && (
                    <div className="flex items-center gap-2 bg-purple-600/20 border border-purple-500/30 rounded-full px-4 py-2">
                      <span className="text-lg">🙋</span>
                      <span className="text-2xl font-bold text-purple-300">{current.me_too_count}</span>
                      <span className="text-purple-400 text-sm font-medium">me too</span>
                    </div>
                  )}
                  {displayIndex === 0 && (
                    <span className="bg-yellow-400/20 border border-yellow-400/30 text-yellow-300 text-sm font-bold px-3 py-1 rounded-full">
                      🏆 TOP QUESTION
                    </span>
                  )}
                  <span className="text-gray-600 text-sm ml-auto">{displayIndex + 1} of {questions.length}</span>
                </div>

                <div className="bg-gray-900 rounded-3xl p-8 mb-6 border border-gray-800">
                  <p className="text-white font-medium leading-relaxed" style={{ fontSize: 'clamp(1.5rem, 3.5vw, 2.5rem)' }}>
                    &ldquo;{current.text}&rdquo;
                  </p>
                  {(!current.is_anonymous && current.author_name) && (
                    <p className="text-gray-500 mt-4 text-base">— {current.author_name}</p>
                  )}
                </div>

                <div className="flex items-center justify-center gap-4">
                  <button onClick={() => setDisplayIndex((i) => Math.max(0, i - 1))} disabled={displayIndex === 0}
                    className="px-5 py-2.5 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm disabled:opacity-30 transition-all">
                    ← Previous
                  </button>
                  <div className="flex gap-2">
                    {questions.slice(0, 8).map((_, i) => (
                      <button key={i} onClick={() => setDisplayIndex(i)}
                        className={`rounded-full transition-all ${i === displayIndex ? 'w-6 h-2.5 bg-blue-400' : 'w-2.5 h-2.5 bg-gray-700 hover:bg-gray-500'}`} />
                    ))}
                  </div>
                  <button onClick={() => setDisplayIndex((i) => Math.min(questions.length - 1, i + 1))} disabled={displayIndex >= questions.length - 1}
                    className="px-5 py-2.5 rounded-full bg-gray-800 hover:bg-gray-700 text-gray-300 font-medium text-sm disabled:opacity-30 transition-all">
                    Next →
                  </button>
                </div>
              </div>

              {questions[displayIndex + 1] && (
                <div className="mt-8 w-full max-w-4xl">
                  <p className="text-xs text-gray-600 uppercase tracking-widest mb-2 font-medium">Up next</p>
                  <div className="bg-gray-900/60 rounded-xl p-3 flex items-center gap-3 border border-gray-800/50">
                    <span className="text-blue-400 text-sm">▲ {questions[displayIndex + 1].votes}</span>
                    {(questions[displayIndex + 1].me_too_count ?? 0) > 0 && (
                      <span className="text-purple-400 text-sm">🙋 {questions[displayIndex + 1].me_too_count}</span>
                    )}
                    <p className="text-gray-500 text-sm truncate">{questions[displayIndex + 1].text}</p>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center">
              <div className="text-6xl mb-6">🎤</div>
              <p className="text-3xl font-semibold text-gray-400 mb-2">Waiting for questions…</p>
              <p className="text-gray-600 text-lg">Participants can scan the QR code to submit</p>
              <div className="mt-6">
                <span className="text-gray-700 text-xl font-mono font-bold tracking-widest bg-gray-900 px-5 py-2 rounded-xl">{id}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between px-6 py-2 bg-gray-900/40 text-xs text-gray-700">
        <span>{session.host_name && `Hosted by ${session.host_name} · `}Google Connect AMA</span>
        <span className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />Live
        </span>
      </div>
    </div>
  );
}
