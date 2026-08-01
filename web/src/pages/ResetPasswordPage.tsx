import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export function ResetPasswordPage() {
  const { storeSlug, api } = useApp();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const navigate = useNavigate();

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.resetPassword(token || '', password);
      navigate(`/${storeSlug}/login`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-page">
        <h1>Invalid link</h1>
        <p className="muted">This reset link is missing its token. Request a new one from the login page.</p>
        <p className="muted">
          <Link to={`/${storeSlug}/login`}>Back to login</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="auth-page" onSubmit={handleSubmit}>
      <h1>Reset Password</h1>
      <input
        placeholder="New password (min 8 characters)"
        type="password"
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        Reset Password
      </button>
    </form>
  );
}
