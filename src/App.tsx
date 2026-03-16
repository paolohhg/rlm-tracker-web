import { useState } from 'react';
import { Dashboard } from './components/Dashboard';
import { HMCycles } from './components/HMCycles';
import { Heard2HTab } from './components/Heard2H/Heard2HTab';

type Tab = 'dashboard' | 'cycles' | 'heard2h';

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard');

  const tabStyle = (active: boolean) => ({
    background: active ? '#2563eb' : 'transparent',
    border: active ? 'none' : '1px solid rgba(255,255,255,0.12)',
    color: active ? '#fff' : '#94a3b8',
    borderRadius: '10px',
    padding: '8px 18px',
    cursor: 'pointer',
    fontWeight: 900,
    fontSize: '13px',
    fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
  });

  return (
    <div style={{ background: '#020617', minHeight: '100vh' }}>
      <div style={{ display: 'flex', gap: '8px', padding: '14px 20px 0', maxWidth: '1400px', margin: '0 auto' }}>
        <button style={tabStyle(tab === 'dashboard')} onClick={() => setTab('dashboard')}>
          📡 RLM Dashboard
        </button>
        <button style={tabStyle(tab === 'cycles')} onClick={() => setTab('cycles')}>
          📋 HM Cycles
        </button>
        <button style={tabStyle(tab === 'heard2h')} onClick={() => setTab('heard2h')}>
          📊 2H Analysis
        </button>
      </div>
      {tab === 'dashboard' && <Dashboard />}
      {tab === 'cycles' && <HMCycles />}
      {tab === 'heard2h' && <Heard2HTab />}
    </div>
  );
}
