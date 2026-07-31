import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import logo from '../assets/logo.png';

export function Header() {
  const { storeSlug, cart, customer, logout } = useApp();
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <header className="header">
      <Link to={`/${storeSlug}`} className="brand">
        <img src={logo} alt="SAMWILL" className="brand-logo" />
        SAMWILL Kitchen
      </Link>
      <nav>
        <Link to={`/${storeSlug}/menu`}>Menu</Link>
        {customer ? (
          <>
            <Link to={`/${storeSlug}/account`}>Hi, {customer.name.split(' ')[0]}</Link>
            <button className="link-btn" onClick={logout}>
              Log out
            </button>
          </>
        ) : (
          <Link to={`/${storeSlug}/login`}>Log in</Link>
        )}
        <Link to={`/${storeSlug}/cart`} className="cart-link">
          Cart{itemCount > 0 ? ` (${itemCount})` : ''}
        </Link>
      </nav>
    </header>
  );
}
