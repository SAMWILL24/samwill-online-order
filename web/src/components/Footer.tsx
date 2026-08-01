import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';

export function Footer() {
  const { storeSlug } = useApp();
  return (
    <footer className="footer">
      <Link to={`/${storeSlug}/terms`}>Terms of Service</Link>
      <span aria-hidden="true"> &middot; </span>
      <Link to={`/${storeSlug}/privacy`}>Privacy Policy</Link>
    </footer>
  );
}
