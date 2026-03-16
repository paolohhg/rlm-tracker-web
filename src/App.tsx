import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { Heard2HTab } from './components/Heard2H/Heard2HTab';

type Tab = 'dashboard' | 'heard2h';

const FONT = 'Inter, "Segoe UI", Arial, sans-serif';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  const tabStyle = (active: boolean): React.CSSProperties => ({
    background: active ? '#00e5ff' : 'transparent',
    border: active ? 'none' : '1px solid #1f2636',
    color: active ? '#000' : '#94a3b8',
    borderRadius: '6px',
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '12px',
    fontFamily: FONT,
    transition: 'all 150ms',
  });

  return (
    <div style={{ background: '#0b0f19', minHeight: '100vh' }}>
      {/* Top Nav Bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 20px',
        maxWidth: '1400px',
        margin: '0 auto',
        borderBottom: '1px solid #1f2636',
      }}>
        {/* Logo + Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img
            src="/hsi-logo.jpg"
            alt="Heard Sports Intelligence"
            style={{ height: '36px', width: '36px', borderRadius: '8px', objectFit: 'cover' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
            <span style={{ color: '#ffffff', fontWeight: 800, fontSize: '16px', fontFamily: FONT, letterSpacing: '0.04em' }}>
              HEARD
            </span>
            <span style={{ color: '#00e5ff', fontWeight: 600, fontSize: '9px', fontFamily: FONT, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Sports Intelligence
            </span>
          </div>
        </div>

        {/* Tab Buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <button style={tabStyle(tab === 'dashboard')} onClick={() => setTab('dashboard')}>
            Dashboard
          </button>
          <button style={tabStyle(tab === 'heard2h')} onClick={() => setTab('heard2h')}>
            2H Analysis
          </button>
        </div>
      </div>

      {tab === 'dashboard' && <Dashboard />}
      {tab === 'heard2h' && <Heard2HTab />}
    </div>
  );
}
