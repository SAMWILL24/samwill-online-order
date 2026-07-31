import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export function LoginPage() {
  const { storeSlug, login } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate(`/${storeSlug}/menu`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-page" onSubmit={handleSubmit}>
      <h1>Log In</h1>
      <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input
        placeholder="Password"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        Log In
      </button>
      <p className="muted">
        No account? <Link to={`/${storeSlug}/register`}>Register</Link>
      </p>
    </form>
  );
}
