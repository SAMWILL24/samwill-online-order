import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export function RegisterPage() {
  const { storeSlug, register } = useApp();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register(email, password, name, phone);
      navigate(`/${storeSlug}/menu`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="auth-page" onSubmit={handleSubmit}>
      <h1>Create Account</h1>
      <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} required />
      <input placeholder="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} required />
      <p className="muted" style={{ fontSize: '0.8rem' }}>
        By providing your phone number, you agree to receive order-status text messages. Message and data
        rates may apply. See our{' '}
        <a href={`/${storeSlug}/terms`} target="_blank" rel="noreferrer">
          Terms
        </a>{' '}
        and{' '}
        <a href={`/${storeSlug}/privacy`} target="_blank" rel="noreferrer">
          Privacy Policy
        </a>
        .
      </p>
      <input
        placeholder="Password (min 8 characters)"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        minLength={8}
        required
      />
      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary btn-lg" type="submit" disabled={submitting}>
        Create Account
      </button>
      <p className="muted">
        Already have an account? <Link to={`/${storeSlug}/login`}>Log in</Link>
      </p>
    </form>
  );
}
