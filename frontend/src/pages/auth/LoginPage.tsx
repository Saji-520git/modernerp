import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

// ── Business details — edit these to match your company ──────────────────────
const BUSINESS = {
  name:    'A.C.M STORES',
  address: 'No. 123, Hurimaluwa, Rambukkana',
  phone:   '+94 11 234 5678',
  email:   'acmstores@gmail.com',
  website: 'www.acmstores.local',
};

// ── Feature cards ─────────────────────────────────────────────────────────────
const FEATURES = [
  { icon: '⊞', label: 'All in One',         sub: 'Complete business solution' },
  { icon: '📊', label: 'Real-time Insights', sub: 'Live analytics & reporting' },
  { icon: '🛡️', label: 'Secure & Reliable',  sub: 'Enterprise grade security' },
  { icon: '⚡', label: 'Productivity',       sub: 'Automate & streamline work' },
];

export default function LoginPage() {
  const [email,    setEmail]    = useState('admin@modernerp.local');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [remember, setRemember] = useState(true);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const navigate = useNavigate();
  const setAuth  = useAuthStore((s) => s.setAuth);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('/auth/login', { email, password });
      setAuth(data.user, data.access, data.refresh);
      navigate('/');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Invalid credentials. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  /* ── shared styles ────────────────────────────────────────────────────────── */
  const inputStyle: React.CSSProperties = {
    width: '100%', paddingLeft: 40, paddingRight: 16,
    paddingTop: 11, paddingBottom: 11,
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(74,158,255,0.25)',
    borderRadius: 9, color: 'white', fontSize: 13,
    outline: 'none', boxSizing: 'border-box',
    transition: 'border-color 0.2s',
  };

  const iconWrap: React.CSSProperties = {
    position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
    color: '#4a9eff', pointerEvents: 'none',
  };

  return (
    <div
      style={{
        height: '100vh', display: 'flex', overflow: 'hidden',
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >

      {/* ── Left panel — branding ──────────────────────────────────────────── */}
      <div
        className="hidden lg:flex flex-col justify-between"
        style={{
          flex: 1, padding: '28px 36px', position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(135deg, #020B18 0%, #0A1628 40%, #0D2244 70%, #0F2D5A 100%)',
        }}
      >
        {/* Background effects */}
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', top: '-10%', right: '-5%', width: 420, height: 420,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(30,80,200,0.18) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', bottom: '-5%', left: '10%', width: 340, height: 340,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(0,120,255,0.12) 0%, transparent 70%)',
          }} />
          <div style={{
            position: 'absolute', inset: 0, opacity: 0.13,
            backgroundImage: 'radial-gradient(circle, #4a90d9 1px, transparent 1px)',
            backgroundSize: '30px 30px',
          }} />
        </div>

        {/* Logo */}
        <div style={{ position: 'relative', zIndex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40,
              clipPath: 'polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)',
              background: 'linear-gradient(135deg, #1a56db, #0ea5e9)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <span style={{ color: 'white', fontSize: 16, fontWeight: 900 }}>P</span>
            </div>
            <div>
              <div style={{ color: 'white', fontWeight: 800, fontSize: 19, letterSpacing: 2, lineHeight: 1 }}>
                MODERN <span style={{ color: '#4a9eff' }}>ERP</span>
              </div>
              <div style={{ color: '#6b9fd4', fontSize: 8, letterSpacing: 3, fontWeight: 600 }}>
                SMARTER. FASTER. TOGETHER.
              </div>
            </div>
          </div>
        </div>

        {/* Hero + cards */}
        <div style={{ position: 'relative', zIndex: 1, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '16px 0' }}>
          <p style={{ color: '#4a9eff', fontWeight: 700, fontSize: 13, letterSpacing: 1, marginBottom: 4 }}>
            Welcome to
          </p>
          <h1 style={{ color: 'white', fontWeight: 900, fontSize: 44, lineHeight: 1.05, marginBottom: 6 }}>
            MODERN <span style={{ color: '#4a9eff' }}>ERP</span>
          </h1>
          <p style={{ color: '#4a9eff', fontWeight: 700, fontSize: 15, marginBottom: 8 }}>
            One Platform. Unlimited Possibilities.
          </p>
          <p style={{ color: '#8ab4d4', fontSize: 13, lineHeight: 1.65, maxWidth: 380, marginBottom: 0 }}>
            Streamline your business operations, boost productivity,
            and make smarter decisions with Modern ERP.
          </p>

          {/* Feature cards */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 18, maxWidth: 460 }}>
            {FEATURES.map((f) => (
              <div key={f.label} style={{
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(74,158,255,0.2)',
                borderRadius: 10, padding: '10px 13px',
              }}>
                <div style={{ fontSize: 20, marginBottom: 4 }}>{f.icon}</div>
                <div style={{ color: 'white', fontWeight: 700, fontSize: 12, marginBottom: 2 }}>{f.label}</div>
                <div style={{ color: '#7aa8cc', fontSize: 10, lineHeight: 1.4 }}>{f.sub}</div>
              </div>
            ))}
          </div>

          {/* Quote */}
          <div style={{
            marginTop: 16, padding: '12px 16px',
            background: 'rgba(74,158,255,0.07)',
            border: '1px solid rgba(74,158,255,0.18)',
            borderRadius: 10, maxWidth: 380,
          }}>
            <div style={{ color: '#4a9eff', fontSize: 22, lineHeight: 1, marginBottom: 4, fontFamily: 'Georgia, serif' }}>"</div>
            <p style={{ color: '#a0c4e8', fontSize: 12, lineHeight: 1.6, fontStyle: 'italic', margin: 0 }}>
              Technology empowers business, and ERP transforms the future.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#4a9eff', fontSize: 12 }}>🛡️</span>
          <span style={{ color: '#6b9fd4', fontSize: 11 }}>© 2024 Modern ERP. All rights reserved.</span>
        </div>
      </div>

      {/* ── Right panel — login form ───────────────────────────────────────── */}
      <div
        className="flex flex-col justify-center w-full lg:w-auto lg:min-w-[460px] xl:min-w-[500px]"
        style={{
          padding: '24px 32px',
          background: 'linear-gradient(160deg, #060E1C 0%, #0B1A32 50%, #0D2040 100%)',
        }}
      >
        <div style={{ width: '100%', maxWidth: 400, margin: '0 auto' }}>

          {/* Lock icon + heading */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 20 }}>
            <div style={{
              width: 58, height: 58, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(26,86,219,0.4), rgba(14,165,233,0.4))',
              border: '1px solid rgba(74,158,255,0.4)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 0 24px rgba(74,158,255,0.2)',
              marginBottom: 10,
            }}>
              <svg width="24" height="24" fill="none" stroke="rgba(74,158,255,0.9)" strokeWidth="1.8" viewBox="0 0 24 24">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            </div>
            <h2 style={{ color: 'white', fontWeight: 800, fontSize: 22, marginBottom: 3 }}>Sign In</h2>
            <p style={{ color: '#6b9fd4', fontSize: 12, margin: 0 }}>Access your Modern ERP account</p>
          </div>

          {/* Form */}
          <form onSubmit={onSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Email */}
            <div style={{ position: 'relative' }}>
              <div style={iconWrap}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                  <circle cx="12" cy="7" r="4"/>
                </svg>
              </div>
              <input
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="Username / Email" required style={inputStyle}
                onFocus={(e) => e.target.style.borderColor = 'rgba(74,158,255,0.7)'}
                onBlur={(e)  => e.target.style.borderColor = 'rgba(74,158,255,0.25)'}
              />
            </div>

            {/* Password */}
            <div style={{ position: 'relative' }}>
              <div style={iconWrap}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
              </div>
              <input
                type={showPass ? 'text' : 'password'} value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password" required
                style={{ ...inputStyle, paddingRight: 44 }}
                onFocus={(e) => e.target.style.borderColor = 'rgba(74,158,255,0.7)'}
                onBlur={(e)  => e.target.style.borderColor = 'rgba(74,158,255,0.25)'}
              />
              <button
                type="button" onClick={() => setShowPass((v) => !v)}
                style={{
                  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                  color: '#6b9fd4', background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                }}
              >
                {showPass ? (
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                ) : (
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                )}
              </button>
            </div>

            {/* Remember me + Forgot */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                <div
                  onClick={() => setRemember((v) => !v)}
                  style={{
                    width: 16, height: 16, borderRadius: 3,
                    border: '1.5px solid rgba(74,158,255,0.5)',
                    background: remember ? 'rgba(74,158,255,0.8)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
                  }}
                >
                  {remember && (
                    <svg width="10" height="8" viewBox="0 0 11 9" fill="none">
                      <path d="M1 4.5L4 7.5L10 1" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
                <span style={{ color: '#8ab4d4', fontSize: 12 }}>Remember me</span>
              </label>
              <button type="button" style={{
                background: 'none', border: 'none', color: '#4a9eff',
                fontSize: 12, cursor: 'pointer', padding: 0,
              }}>
                Forgot Password?
              </button>
            </div>

            {/* Error */}
            {error && (
              <div style={{
                background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)',
                borderRadius: 7, padding: '8px 12px',
                color: '#fca5a5', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 7,
              }}>
                <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                  <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit" disabled={loading}
              style={{
                width: '100%', paddingTop: 13, paddingBottom: 13,
                background: loading
                  ? 'rgba(26,86,219,0.5)'
                  : 'linear-gradient(90deg, #1a56db 0%, #0ea5e9 100%)',
                border: 'none', borderRadius: 9,
                color: 'white', fontSize: 15, fontWeight: 700,
                cursor: loading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
                boxShadow: loading ? 'none' : '0 4px 18px rgba(26,86,219,0.4)',
                transition: 'opacity 0.2s, box-shadow 0.2s',
                letterSpacing: 0.5,
              }}
            >
              {loading ? (
                <>
                  <span style={{
                    width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)',
                    borderTopColor: 'white', borderRadius: '50%',
                    display: 'inline-block', animation: 'spin 0.7s linear infinite',
                  }} />
                  Signing in…
                </>
              ) : (
                <>
                  Login
                  <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                </>
              )}
            </button>
          </form>

          {/* Business details card */}
          <div style={{
            marginTop: 16,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(74,158,255,0.18)',
            borderRadius: 12, overflow: 'hidden',
          }}>
            <div style={{
              padding: '7px 14px',
              borderBottom: '1px solid rgba(74,158,255,0.12)',
              color: '#8ab4d4', fontSize: 10, fontWeight: 600,
              letterSpacing: 0.5, textAlign: 'center', textTransform: 'uppercase',
            }}>
              Business Details
            </div>
            {[
              {
                icon: <svg width="13" height="13" fill="none" stroke="#4a9eff" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>,
                label: 'Business Name', value: BUSINESS.name,
              },
              {
                icon: <svg width="13" height="13" fill="none" stroke="#4a9eff" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>,
                label: 'Address', value: BUSINESS.address,
              },
              {
                icon: <svg width="13" height="13" fill="none" stroke="#4a9eff" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.62 1.27h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6 6l.96-.96a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>,
                label: 'Phone', value: BUSINESS.phone,
              },
              {
                icon: <svg width="13" height="13" fill="none" stroke="#4a9eff" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>,
                label: 'Email', value: BUSINESS.email,
              },
              {
                icon: <svg width="13" height="13" fill="none" stroke="#4a9eff" strokeWidth="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>,
                label: 'Website', value: BUSINESS.website,
              },
            ].map((row) => (
              <div key={row.label} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 14px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
              }}>
                <div style={{ flexShrink: 0 }}>{row.icon}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                  <span style={{ color: '#5b87b0', fontSize: 9, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', flexShrink: 0 }}>
                    {row.label}:
                  </span>
                  <span style={{ color: '#d0e8ff', fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {row.value}
                  </span>
                </div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* Keyframes + input styles */}
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        input::placeholder { color: rgba(107,159,212,0.7); }
        input:-webkit-autofill,
        input:-webkit-autofill:hover,
        input:-webkit-autofill:focus {
          -webkit-text-fill-color: white !important;
          -webkit-box-shadow: 0 0 0px 1000px rgba(10,22,40,0.95) inset !important;
          transition: background-color 5000s ease-in-out 0s;
        }
      `}</style>
    </div>
  );
}
