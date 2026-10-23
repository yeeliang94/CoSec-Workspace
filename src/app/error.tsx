'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h1>This page could not be loaded</h1>
      <button onClick={reset}>Try again</button>
    </div>
  );
}
