import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="empty">
      <h1>Record unavailable</h1>
      <Link href="/resolutions">Return to Resolutions</Link>
    </div>
  );
}
