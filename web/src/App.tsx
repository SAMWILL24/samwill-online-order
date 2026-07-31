import { useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import { Header } from './components/Header';
import { IntroPage } from './pages/IntroPage';
import { MenuPage } from './pages/MenuPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AccountPage } from './pages/AccountPage';
import { api } from './api';
import { darken } from './lib/color';
import './App.css';

function useDynamicAccentColor() {
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        if (!s.themeAccentColor) return;
        document.documentElement.style.setProperty('--accent', s.themeAccentColor);
        document.documentElement.style.setProperty('--accent-dark', darken(s.themeAccentColor));
      })
      .catch(() => {});
  }, []);
}

function App() {
  useDynamicAccentColor();
  return (
    <AppProvider>
      <Header />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<IntroPage />} />
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order/:id" element={<OrderTrackingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/account" element={<AccountPage />} />
        </Routes>
      </main>
    </AppProvider>
  );
}

export default App;
