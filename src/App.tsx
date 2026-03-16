import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { HMCycles } from './components/HMCycles';
import { Heard2HTab } from './components/Heard2H/Heard2HTab';

type Tab = 'dashboard' | 'cycles' | 'heard2h';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  const tabStyle = (active: boolean) => ({
    background: active ? '#00e5ff' : 'transparent',
    border: active ? 'none' : '1px solid #1f2636',
    color: active ? '#000' : '#94a3b8',
    borderRadius: '6px',
    padding: '8px 16px',
    cursor: 'pointer' as const,
    fontWeight: 700,
    fontSize: '12px',
    fontFamily: 'Inter, "Segoe UI", Arial, sans-serif',
    transition: 'all 150ms',
  });

  return (
    <div style={{ background: '#0b0f19', minHeight: '100vh' }}>
      <div style={{ display: 'flex', gap: '6px', padding: '14px 20px 0', maxWidth: '1400px', margin: '0 auto' }}>
        <button style={tabStyle(tab === 'dashboard')} onClick={() => setTab('dashboard')}>
          Dashboard
        </button>
        <button style={tabStyle(tab === 'cycles')} onClick={() => setTab('cycles')}>
          HM Cycles
        </button>
        <button style={tabStyle(tab === 'heard2h')} onClick={() => setTab('heard2h')}>
          2H Analysis
        </button>
      </div>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'cycles' && <HMCycles />}
      {tab === 'heard2h' && <Heard2HTab />}
    </div>
  );
}
