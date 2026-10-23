'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { request } from '@/components/workspace';
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  return (
    <main className="login-page">
      <section className="login-box">
        <div className="login-brand">CoSec Workspace</div>
        <h1>Sign in</h1>
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError('');
            const data = new FormData(event.currentTarget);
            try {
              await request('/api/auth/sign-in/email', {
                email: data.get('email'),
                password: data.get('password'),
              });
              router.replace('/work');
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Sign in failed');
            } finally {
              setPending(false);
            }
          }}
        >
          <label>
            Email
            <input name="email" type="email" autoComplete="username" required autoFocus />
          </label>
          <label>
            Password
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {error ? (
            <div className="feedback error" role="alert">
              {error}
            </div>
          ) : null}
          <button className="primary" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </section>
    </main>
  );
}
