import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export function RegisterPage() {
  const { register } = useApp();
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
      navigate('/menu');
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
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </form>
  );
}
