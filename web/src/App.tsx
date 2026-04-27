import { useState, useEffect } from "react";
import type { Book } from "./types";
import ConstellationMap from "./components/ConstellationMap";

export default function App() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/data/books.json")
      .then((r) => r.json())
      .then((data: Book[]) => {
        setBooks(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load books:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div className="absolute inset-0 bg-void flex items-center justify-center">
        <p className="text-secondary text-sm tracking-wider font-sans font-medium">Loading library...</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0">
      <ConstellationMap books={books} />
    </div>
  );
}
