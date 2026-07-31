import { Link } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import logo from '../assets/logo.png';

export function Header() {
  const { cart, customer, logout } = useApp();
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  return (
    <header className="header">
      <Link to="/" className="brand">
        <img src={logo} alt="SAMWILL" className="brand-logo" />
        SAMWILL Kitchen
      </Link>
      <nav>
        <Link to="/menu">Menu</Link>
        {customer ? (
          <>
            <Link to="/account">Hi, {customer.name.split(' ')[0]}</Link>
            <button className="link-btn" onClick={logout}>
              Log out
            </button>
          </>
        ) : (
          <Link to="/login">Log in</Link>
        )}
        <Link to="/cart" className="cart-link">
          Cart{itemCount > 0 ? ` (${itemCount})` : ''}
        </Link>
      </nav>
    </header>
  );
}
