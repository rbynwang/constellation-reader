export type BookNode = Book;

export interface Book {
  id: string;
  title: string;
  author: string;
  x: number;
  y: number;
  coverUrl?: string;
  year?: number;
  description?: string;
  dominantColor?: string;
}

export interface QuestionCandidate {
  question: string;
  interpretation: string;
  book_grounding?: Record<string, string>;
}

export interface AnnotatedBook {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  annotation: string;
  parent_book_id: string;
}

export interface SavedConstellation {
  id: string;
  savedAt: string;
  bookIds: string[];
  bookCovers: (string | null)[];
  bookTitles: string[];
  questions: QuestionCandidate[];
  chosenQuestionIndex: number | null;
  furtherReading: AnnotatedBook[] | null;
}

export interface ConstellationState {
  selectedIds: string[];
  questions: QuestionCandidate[];
  chosenQuestion: QuestionCandidate | null;
  furtherReading: AnnotatedBook[];
  phase: "browse" | "questions" | "constellation";
}
