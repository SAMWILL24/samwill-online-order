import { useEffect } from 'react';
import { Navigate, Outlet, Route, Routes, useParams } from 'react-router-dom';
import { AppProvider, useApp } from './context/AppContext';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { IntroPage } from './pages/IntroPage';
import { MenuPage } from './pages/MenuPage';
import { CartPage } from './pages/CartPage';
import { CheckoutPage } from './pages/CheckoutPage';
import { OrderTrackingPage } from './pages/OrderTrackingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { AccountPage } from './pages/AccountPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { TermsPage } from './pages/TermsPage';
import { PrivacyPage } from './pages/PrivacyPage';
import { darken } from './lib/color';
import './App.css';

function useDynamicAccentColor() {
  const { api } = useApp();
  useEffect(() => {
    api
      .getSettings()
      .then((s) => {
        if (!s.themeAccentColor) return;
        document.documentElement.style.setProperty('--accent', s.themeAccentColor);
        document.documentElement.style.setProperty('--accent-dark', darken(s.themeAccentColor));
      })
      .catch(() => {});
  }, [api]);
}

function StoreShell() {
  useDynamicAccentColor();
  return (
    <>
      <Header />
      <main className="app-main">
        <Outlet />
      </main>
      <Footer />
    </>
  );
}

function StoreLayout() {
  const { storeSlug } = useParams<{ storeSlug: string }>();
  if (!storeSlug) return <Navigate to="/" replace />;
  return (
    <AppProvider storeSlug={storeSlug}>
      <StoreShell />
    </AppProvider>
  );
}

function NoStoreSelected() {
  return (
    <main className="app-main">
      <p>No restaurant selected. Please use the ordering link your restaurant gave you.</p>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route path="/:storeSlug" element={<StoreLayout />}>
        <Route index element={<IntroPage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="order/:id" element={<OrderTrackingPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
        <Route path="reset-password" element={<ResetPasswordPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="terms" element={<TermsPage />} />
        <Route path="privacy" element={<PrivacyPage />} />
      </Route>
      <Route path="/" element={<NoStoreSelected />} />
    </Routes>
  );
}

export default App;
