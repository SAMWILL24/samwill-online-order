import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export function ForgotPasswordPage() {
  const { storeSlug, api } = useApp();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.forgotPassword(email);
      setSent(true);
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="auth-page">
        <h1>Check your email</h1>
        <p className="muted">
          If an account exists for that email, we've sent a link to reset the password. The link expires in 1 hour.
        </p>
        <p className="muted">
          <Link to={`/${storeSlug}/login`}>Back to login</Link>
        </p>
      </div>
    );
  }

  return (
    <form className="auth-page" onSubmit={handleSubmit}>
      <h1>Forgot Password</h1>
      <p className="muted">Enter your email and we'll send you a link to reset your password.</p>
      <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        Send Reset Link
      </button>
      <p className="muted">
        <Link to={`/${storeSlug}/login`}>Back to login</Link>
      </p>
    </form>
  );
}
