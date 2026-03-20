import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { OvernightReport } from './components/OvernightReport';
import { OvernightReportAdmin } from './components/OvernightReportAdmin';

const FONT = 'Inter, "Segoe UI", Arial, sans-serif';

type View = 'dashboard' | 'morning-report' | 'admin';

export default function App() {
  const [view, setView] = useState<View>('dashboard');

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

        {/* Nav tabs */}
        <div style={{ display: 'flex', gap: 4 }}>
          <NavTab label="Dashboard" active={view === 'dashboard'} onClick={() => setView('dashboard')} />
          <NavTab label="Morning Report" active={view === 'morning-report'} onClick={() => setView('morning-report')} />
          <NavTab label="Admin" active={view === 'admin'} onClick={() => setView('admin')} subtle />
        </div>
      </div>

      {view === 'dashboard' && <Dashboard />}
      {view === 'morning-report' && <OvernightReport />}
      {view === 'admin' && <OvernightReportAdmin />}
    </div>
  );
}

function NavTab({ label, active, onClick, subtle }: { label: string; active: boolean; onClick: () => void; subtle?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '6px 14px',
        borderRadius: 6,
        border: 'none',
        cursor: 'pointer',
        fontFamily: FONT,
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        background: active ? '#00e5ff' : 'transparent',
        color: active ? '#0b0f19' : subtle ? '#64748b' : '#94a3b8',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}
