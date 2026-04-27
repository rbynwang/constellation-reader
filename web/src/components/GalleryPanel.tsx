import type { SavedConstellation } from "../types";

interface Props {
  entries: SavedConstellation[];
  open: boolean;
  onClose: () => void;
  onRestore: (entry: SavedConstellation) => void;
  onDelete: (id: string) => void;
}

function proxyCover(raw: string): string {
  return raw.replace("https://cdn.sanity.io", "/sanity-cdn");
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function GalleryPanel({ entries, open, onClose, onRestore, onDelete }: Props) {
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
              <path
                d="M3 3L13 13M13 3L3 13"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>

          <div className="px-8 py-10">
            <p className="text-secondary text-[10px] tracking-[0.2em] uppercase font-sans font-medium mb-6">
              Saved constellations
            </p>

            {entries.length === 0 && (
              <p className="text-secondary/60 text-sm font-sans mt-12 text-center leading-relaxed">
                No saved constellations yet.<br />
                Select books and save a question to start.
              </p>
            )}

            <div className="space-y-3">
              {entries.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => onRestore(entry)}
                  className="group relative p-4 rounded-lg border border-white/[0.06]
                             hover:border-glow/25 hover:bg-white/[0.015]
                             transition-all duration-200 cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex -space-x-2 flex-shrink-0 mt-0.5">
                      {entry.bookCovers.slice(0, 3).map((url, i) =>
                        url ? (
                          <img
                            key={i}
                            src={proxyCover(url) + "?w=60&fit=crop&auto=format"}
                            alt=""
                            className="w-8 h-11 object-cover rounded-sm border border-black/50"
                            style={{ zIndex: 3 - i }}
                          />
                        ) : (
                          <div
                            key={i}
                            className="w-8 h-11 rounded-sm bg-white/[0.06] border border-black/50"
                            style={{ zIndex: 3 - i }}
                          />
                        )
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-star text-[14px] font-sans font-bold leading-[1.3] line-clamp-2
                                    group-hover:text-glow transition-colors duration-200">
                        {entry.chosenQuestionIndex != null && entry.questions[entry.chosenQuestionIndex]
                          ? (() => {
                              const q = entry.questions[entry.chosenQuestionIndex!].question;
                              return q.length > 80 ? q.slice(0, 78) + "…" : q;
                            })()
                          : entry.questions[0]?.question
                            ? entry.questions[0].question.length > 80
                              ? entry.questions[0].question.slice(0, 78) + "…"
                              : entry.questions[0].question
                            : "Untitled constellation"}
                      </p>
                      <p className="text-secondary/70 text-[13px] font-mono tracking-[0.02em] mt-1 truncate">
                        {entry.bookTitles.join(" · ")}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-secondary/40 text-[10px] font-mono">
                          {timeAgo(entry.savedAt)}
                        </p>
                        {entry.furtherReading && entry.furtherReading.length > 0 && (
                          <span className="text-[10px] font-mono text-glow/50 bg-glow/[0.06] px-1.5 py-0.5 rounded">
                            +{entry.furtherReading.length} further
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(entry.id);
                    }}
                    className="absolute top-3 right-3 w-7 h-7 flex items-center justify-center
                               rounded-full text-secondary/0 group-hover:text-secondary/60
                               hover:!text-red-400/80 hover:bg-white/[0.05]
                               transition-all duration-200"
                    aria-label="Delete"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                      <path
                        d="M3.5 4.5L4 11.5H10L10.5 4.5M2.5 4.5H11.5M5.5 2.5H8.5M5.5 6.5V9.5M8.5 6.5V9.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
