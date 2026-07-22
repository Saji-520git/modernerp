import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Mail, Lock, Eye, EyeOff, AlertCircle, Loader2, ShoppingCart, Package, BarChart3, Truck } from 'lucide-react';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import ThemeToggle from '../../components/common/ThemeToggle';

export default function LoginPage() {
  const [email,    setEmail]    = useState('admin@modernerp.local');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();
  const setAuth  = useAuthStore((s) => s.setAuth);
  const queryClient = useQueryClient();

  useEffect(() => {
    const saved = localStorage.getItem('last_login_email');
    if (saved) setEmail(saved);
    setPassword('');
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      localStorage.setItem('last_login_email', email);
      // Drop any cached data from a prior account in this tab before entering.
      queryClient.clear();
      setAuth(data.user, data.access, data.refresh);
      navigate('/');
    } catch (err: any) {
      if (!err?.response) {
        // No HTTP response reached the client — server unreachable, network
        // down, or a CORS block (all surface as an error with no `response`).
        // Distinct from bad credentials so the user isn't misdirected.
        setError('Cannot reach the server. Please check your connection and try again.');
      } else if (err.response.status === 401) {
        setError(err.response.data?.message ?? 'Invalid credentials. Please try again.');
      } else {
        setError(err.response.data?.message ?? 'Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit() {
    void onSubmit({ preventDefault() {} } as React.FormEvent);
  }

  return (
    <div className="min-h-screen flex bg-app">

      {/* Left panel — branding. A constant deep indigo→slate showcase in BOTH
          themes (brand chrome is intentionally always-dark), so only literal
          brand colors live here. */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] flex-shrink-0 bg-gradient-to-br from-indigo-900 via-indigo-800 to-slate-900 p-12">

        {/* Logo area */}
        <div>
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center mb-6">
            <span className="text-3xl font-black text-white">B</span>
          </div>
          <h1 className="text-3xl font-black text-white leading-tight">
            Brocode<span className="text-indigo-400"> ERP</span>
          </h1>
          <p className="text-indigo-300/70 text-sm mt-2">
            Retail &amp; Grocery ERP Platform
          </p>
        </div>

        {/* Feature list */}
        <div className="space-y-5 mt-8">
          {[
            { icon: ShoppingCart, title: 'Point of Sale',         desc: 'Fast barcode scanning, keyboard-driven checkout' },
            { icon: Package,      title: 'Inventory Control',     desc: 'Real-time stock, batch tracking, expiry alerts' },
            { icon: BarChart3,    title: 'Sales & Analytics',     desc: 'Revenue reports, top products, profit tracking' },
            { icon: Truck,        title: 'Purchase Management',   desc: 'Supplier orders, GRN, payment tracking' },
          ].map(f => (
            <div key={f.title} className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/10 border border-white/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <f.icon size={16} className="text-indigo-200" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white leading-tight">{f.title}</p>
                <p className="text-xs text-indigo-200/70 mt-0.5 leading-relaxed">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Version */}
        <p className="text-indigo-400/40 text-xs">Version 1.0.0</p>
      </div>

      {/* Right panel — login form (fully tokenized: themes light/dark) */}
      <div className="relative flex-1 flex items-center justify-center p-8 bg-app">

        {/* Theme toggle */}
        <div className="absolute top-5 right-5">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-md">

          {/* Mobile logo */}
          <div className="lg:hidden text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-accent flex items-center justify-center mx-auto mb-3">
              <span className="text-2xl font-black text-accent-fg">B</span>
            </div>
            <h1 className="text-2xl font-black text-content">BROcode ERP</h1>
          </div>

          {/* Form card */}
          <div className="bg-surface rounded-2xl shadow-token-lg border border-line p-8">

            <div className="mb-8">
              <h2 className="text-2xl font-bold text-content">Welcome back</h2>
              <p className="text-content-muted text-sm mt-1">
                Sign in to your account to continue
              </p>
            </div>

            {/* Error alert */}
            {error && (
              <div className="mb-4 p-3 bg-danger-subtle border border-danger rounded-lg flex items-center gap-2 text-danger text-sm">
                <AlertCircle size={16} />
                {error}
              </div>
            )}

            {/* Email field */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-content-secondary mb-1.5">
                Email address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full pl-10 pr-4 py-3 border border-line rounded-xl text-sm text-content bg-surface-inset focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
                  placeholder="admin@example.com"
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password field */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-content-secondary mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-content-muted" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-3 border border-line rounded-xl text-sm text-content bg-surface-inset focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  onKeyDown={e => e.key === 'Enter' && handleSubmit()}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted hover:text-content"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Submit button */}
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full py-3 bg-accent hover:bg-accent-hover disabled:opacity-60 text-accent-fg font-semibold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-content-muted mt-6">
            BROcode ERP v1.0.0 · Retail Management System
          </p>
        </div>
      </div>
    </div>
  );
}
