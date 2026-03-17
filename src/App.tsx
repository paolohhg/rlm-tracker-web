import { Dashboard } from './components/Dashboard';

const FONT = 'Inter, "Segoe UI", Arial, sans-serif';

export default function App() {
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
      </div>

      <Dashboard />
    </div>
  );
}
