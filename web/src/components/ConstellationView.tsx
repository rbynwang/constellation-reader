import type { QuestionCandidate, BookNode, AnnotatedBook } from "../types";

interface Props {
  question: QuestionCandidate;
  selectedBooks: BookNode[];
  furtherReading: AnnotatedBook[];
  onReset: () => void;
}

export default function ConstellationView({
  question,
  selectedBooks,
  furtherReading,
  onReset,
}: Props) {
  return (
    <div className="absolute right-0 top-0 h-full w-full max-w-xl bg-void/95 backdrop-blur-md border-l border-star/10 overflow-y-auto">
      <div className="p-8">
        <button
          onClick={onReset}
          className="text-star/50 hover:text-star text-sm mb-8 transition-colors"
        >
          &larr; New constellation
        </button>

        <div className="mb-10">
          <h1 className="font-serif text-2xl text-glow leading-snug mb-4">
            {question.question}
          </h1>
          <p className="text-star/60 text-sm leading-relaxed">
            {question.interpretation}
          </p>
        </div>

        <div className="mb-10">
          <h3 className="text-xs uppercase tracking-widest text-star/30 mb-4">
            Selected books
          </h3>
          <div className="grid grid-cols-3 gap-3">
            {selectedBooks.map((b) => (
              <div key={b.id} className="text-center">
                {b.coverUrl ? (
                  <img
                    src={b.coverUrl}
                    alt={b.title}
                    className="w-full aspect-[2/3] object-cover rounded mb-2"
                  />
                ) : (
                  <div className="w-full aspect-[2/3] bg-star/10 rounded mb-2 flex items-center justify-center text-star/30 text-xs p-2">
                    {b.title}
                  </div>
                )}
                <p className="text-xs text-star/70 leading-tight">
                  {b.title}
                </p>
                {b.year && (
                  <p className="text-[10px] text-star/30 mt-1">{b.year}</p>
                )}
              </div>
            ))}
          </div>
          {selectedBooks.some((b) => b.year) && (
            <p className="text-xs text-star/30 mt-3 italic">
              {selectedBooks
                .filter((b) => b.year)
                .map((b) => `${b.year}`)
                .join(" · ")}
            </p>
          )}
        </div>

        <div>
          <h3 className="text-xs uppercase tracking-widest text-star/30 mb-4">
            Further reading
          </h3>
          <div className="space-y-6">
            {furtherReading.map((book) => (
              <div key={book.id} className="flex gap-4">
                {book.coverUrl ? (
                  <img
                    src={book.coverUrl}
                    alt={book.title}
                    className="w-16 h-24 object-cover rounded flex-shrink-0"
                  />
                ) : (
                  <div className="w-16 h-24 bg-star/10 rounded flex-shrink-0 flex items-center justify-center text-star/30 text-[10px] p-1 text-center">
                    {book.title}
                  </div>
                )}
                <div>
                  <p className="text-star font-medium text-sm">
                    {book.title}
                  </p>
                  {book.author && (
                    <p className="text-star/50 text-xs mb-2">{book.author}</p>
                  )}
                  <p className="text-star/60 text-sm leading-relaxed">
                    {book.annotation}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-star/10">
          <button
            onClick={onReset}
            className="px-5 py-2.5 bg-glow/90 text-void font-medium rounded-full
                       hover:bg-glow transition-colors duration-200"
          >
            Start a new constellation
          </button>
        </div>
      </div>
    </div>
  );
}
