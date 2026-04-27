import { useState, useEffect, useRef } from "react";
import type { Book, QuestionCandidate, AnnotatedBook } from "../types";

interface Props {
  books: Book[];
  open: boolean;
  onClose: () => void;
  preloadedQuestions?: QuestionCandidate[] | null;
  preloadedChosenIndex?: number | null;
  preloadedFurtherReading?: AnnotatedBook[] | null;
  onSave?: (questions: QuestionCandidate[], chosenIndex: number | null, furtherReading: AnnotatedBook[] | null) => void;
  onFurtherReading?: (books: AnnotatedBook[]) => void;
  onClearFurtherReading?: () => void;
  onFocusBook?: (bookId: string) => void;
}

function proxyCover(raw: string): string {
  return raw.replace("https://cdn.sanity.io", "/sanity-cdn");
}

export default function QuestionPanel({
  books, open, onClose,
  preloadedQuestions, preloadedChosenIndex, preloadedFurtherReading,
  onSave, onFurtherReading, onClearFurtherReading, onFocusBook,
}: Props) {
  const [questions, setQuestions] = useState<QuestionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const fetchedKey = useRef("");

  const [chosenIndex, setChosenIndex] = useState<number | null>(null);
  const [furtherReading, setFurtherReading] = useState<AnnotatedBook[] | null>(null);
  const [extendLoading, setExtendLoading] = useState(false);
  const [extendError, setExtendError] = useState<string | null>(null);

  const bookIdsKey = books.map((b) => b.id).sort().join(",");

  // Load questions (same as before)
  useEffect(() => {
    if (!open || books.length < 2) return;

    if (preloadedQuestions && preloadedQuestions.length > 0) {
      setQuestions(preloadedQuestions);
      fetchedKey.current = bookIdsKey;
      setLoading(false);
      setError(null);
      if (preloadedChosenIndex != null) {
        setChosenIndex(preloadedChosenIndex);
      }
      if (preloadedFurtherReading && preloadedFurtherReading.length > 0) {
        setFurtherReading(preloadedFurtherReading);
        onFurtherReading?.(preloadedFurtherReading);
      }
      return;
    }

    if (bookIdsKey === fetchedKey.current) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setQuestions([]);
    setSaved(false);
    setChosenIndex(null);
    setFurtherReading(null);
    onClearFurtherReading?.();

    fetch("/api/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book_ids: books.map((b) => b.id) }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (!cancelled) {
          setQuestions(data.questions || []);
          fetchedKey.current = bookIdsKey;
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [open, bookIdsKey, retryCount, preloadedQuestions, preloadedChosenIndex, preloadedFurtherReading]);

  useEffect(() => {
    setSaved(false);
  }, [bookIdsKey]);

  // Fetch further reading when a question is chosen
  function handleChooseQuestion(index: number) {
    if (extendLoading) return;
    const q = questions[index];
    if (!q) return;

    setChosenIndex(index);
    setExtendLoading(true);
    setExtendError(null);
    setFurtherReading(null);
    onClearFurtherReading?.();

    fetch("/api/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: q.question,
        question_interpretation: q.interpretation,
        book_ids: books.map((b) => b.id),
      }),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const fr: AnnotatedBook[] = data.further_reading || [];
        setFurtherReading(fr);
        setExtendLoading(false);
        onFurtherReading?.(fr);
      })
      .catch((err) => {
        setExtendError(err.message);
        setExtendLoading(false);
      });
  }

  function handleBack() {
    setChosenIndex(null);
    setFurtherReading(null);
    setExtendError(null);
    onClearFurtherReading?.();
  }

  const showResults = chosenIndex !== null;

  return (
    <>
      <div
        className={`fixed inset-0 z-30 bg-black/30 transition-opacity duration-500 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed top-0 right-0 h-full z-40 transition-transform duration-500 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ width: "min(40vw, 560px)" }}
      >
        <div
          className="h-full bg-[#080808]/[0.95] backdrop-blur-2xl border-l border-white/[0.06]
                     overflow-y-auto overscroll-contain"
        >
          <button
            onClick={onClose}
            className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center
                       text-secondary hover:text-star transition-colors z-50 rounded-full
                       hover:bg-white/[0.05]"
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 3L13 13M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <div className="px-8 py-10">
            {/* Selected books header */}
            <p className="text-secondary text-[10px] tracking-[0.2em] uppercase font-sans font-medium mb-5">
              Selected books
            </p>
            <div className="space-y-3 mb-8">
              {books.map((b) => (
                <div key={b.id} className="flex items-start gap-3">
                  {b.coverUrl && (
                    <img
                      src={proxyCover(b.coverUrl) + "?w=80&fit=crop&auto=format"}
                      alt=""
                      className="w-9 h-[52px] object-cover rounded-sm flex-shrink-0 opacity-90"
                    />
                  )}
                  <div className="min-w-0 pt-0.5">
                    <p className="text-star text-[14px] font-sans font-bold leading-[1.3] truncate">
                      {b.title}
                    </p>
                    <p className="text-secondary/70 text-[13px] font-mono tracking-[0.02em] mt-0.5 truncate">
                      {[b.author, b.year].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div className="h-px bg-white/[0.06] mb-8" />

            {/* Loading questions */}
            {loading && (
              <div className="flex items-center gap-3 py-16 justify-center">
                <span className="block w-1.5 h-1.5 rounded-full bg-glow/80 animate-pulse" />
                <p className="text-secondary text-sm font-sans font-medium tracking-wide">
                  Asking the library…
                </p>
              </div>
            )}

            {/* Error loading questions */}
            {error && (
              <div className="py-8 text-center">
                <p className="text-red-400/80 text-sm font-sans mb-3">{error}</p>
                <button
                  onClick={() => { fetchedKey.current = ""; setRetryCount((c) => c + 1); }}
                  className="text-secondary text-xs font-sans underline hover:text-star transition-colors"
                >
                  try again
                </button>
              </div>
            )}

            {/* Questions list mode */}
            {!loading && !error && questions.length > 0 && !showResults && (
              <div className="space-y-5">
                <p className="text-secondary text-[10px] tracking-[0.2em] uppercase font-sans font-medium mb-2">
                  Questions these books gather around
                </p>
                {questions.map((q, i) => (
                  <div
                    key={i}
                    onClick={() => handleChooseQuestion(i)}
                    className="p-5 rounded-lg border border-white/[0.06]
                               hover:border-glow/25 hover:bg-white/[0.015]
                               transition-all duration-200 cursor-pointer group"
                  >
                    <p className="text-star text-[18px] font-sans font-bold leading-[1.3]
                                 group-hover:text-glow transition-colors duration-200">
                      {q.question}
                    </p>
                    <p className="text-star/[0.85] text-[14px] font-sans leading-[1.6] mt-3">
                      {q.interpretation}
                    </p>
                    <p className="text-secondary/40 text-[11px] font-sans mt-3
                                 group-hover:text-glow/60 transition-colors duration-200">
                      Click to find further reading →
                    </p>
                  </div>
                ))}

                {onSave && (
                  <button
                    onClick={() => { onSave(questions, null, null); setSaved(true); }}
                    disabled={saved}
                    className={`w-full mt-4 py-2.5 rounded-lg text-sm font-sans font-medium tracking-wide
                               transition-all duration-300 ${
                      saved
                        ? "bg-white/[0.04] border border-white/[0.08] text-secondary/60 cursor-default"
                        : "bg-glow/10 border border-glow/30 text-glow hover:bg-glow/20 hover:border-glow/50"
                    }`}
                  >
                    {saved ? "Saved to gallery" : "Save to gallery"}
                  </button>
                )}
              </div>
            )}

            {/* Results mode — chosen question + further reading */}
            {!loading && !error && showResults && (
              <div className="space-y-5">
                {/* Back button */}
                <button
                  onClick={handleBack}
                  className="flex items-center gap-2 text-secondary/70 text-[13px] font-sans
                             hover:text-star transition-colors duration-200 mb-2"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Back to questions
                </button>

                {/* Chosen question */}
                <div className="p-5 rounded-lg border border-glow/30 bg-glow/[0.03]">
                  <p className="text-glow text-[18px] font-sans font-bold leading-[1.3]">
                    {questions[chosenIndex!]?.question}
                  </p>
                  <p className="text-star/[0.85] text-[14px] font-sans leading-[1.6] mt-3">
                    {questions[chosenIndex!]?.interpretation}
                  </p>
                </div>

                <div className="h-px bg-white/[0.06]" />

                {/* Loading further reading */}
                {extendLoading && (
                  <div className="flex items-center gap-3 py-12 justify-center">
                    <span className="block w-1.5 h-1.5 rounded-full bg-glow/80 animate-pulse" />
                    <p className="text-secondary text-sm font-sans font-medium tracking-wide">
                      Finding further reading…
                    </p>
                  </div>
                )}

                {/* Error loading further reading */}
                {extendError && (
                  <div className="py-8 text-center">
                    <p className="text-red-400/80 text-sm font-sans mb-3">{extendError}</p>
                    <button
                      onClick={() => handleChooseQuestion(chosenIndex!)}
                      className="text-secondary text-xs font-sans underline hover:text-star transition-colors"
                    >
                      try again
                    </button>
                  </div>
                )}

                {/* Further reading results */}
                {furtherReading && furtherReading.length > 0 && (
                  <div className="space-y-4">
                    <p className="text-secondary text-[10px] tracking-[0.2em] uppercase font-sans font-medium">
                      Further reading
                    </p>
                    {furtherReading.map((fr, i) => (
                      <div
                        key={fr.id}
                        onClick={() => onFocusBook?.(fr.id)}
                        className="flex gap-4 p-4 rounded-lg border border-white/[0.06]
                                   hover:border-glow/25 hover:bg-white/[0.015]
                                   transition-all duration-200 cursor-pointer group"
                      >
                        <div className="flex-shrink-0 flex items-start gap-3">
                          <span className="flex items-center justify-center w-6 h-6 rounded-full
                                         bg-glow/15 text-glow text-[11px] font-mono font-bold mt-0.5">
                            {i + 1}
                          </span>
                          {fr.coverUrl && (
                            <img
                              src={proxyCover(fr.coverUrl) + "?w=100&fit=crop&auto=format"}
                              alt=""
                              className="w-10 h-[56px] object-cover rounded-sm opacity-90"
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-star text-[15px] font-sans font-bold leading-[1.3]
                                       group-hover:text-glow transition-colors duration-200">
                            {fr.title}
                          </p>
                          <p className="text-secondary/70 text-[12px] font-mono tracking-[0.02em] mt-0.5">
                            {fr.author}
                          </p>
                          <p className="text-star/[0.75] text-[13px] font-sans leading-[1.5] mt-2">
                            {fr.annotation}
                          </p>
                        </div>
                      </div>
                    ))}

                    {onSave && (
                      <button
                        onClick={() => { onSave(questions, chosenIndex, furtherReading); setSaved(true); }}
                        disabled={saved}
                        className={`w-full mt-4 py-2.5 rounded-lg text-sm font-sans font-medium tracking-wide
                                   transition-all duration-300 ${
                          saved
                            ? "bg-white/[0.04] border border-white/[0.08] text-secondary/60 cursor-default"
                            : "bg-glow/10 border border-glow/30 text-glow hover:bg-glow/20 hover:border-glow/50"
                        }`}
                      >
                        {saved ? "Saved to gallery" : "Save constellation"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
