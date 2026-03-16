import { useState } from 'react';
import { AnalysisForm } from './AnalysisForm';
import { AnalysisResult } from './AnalysisResult';
import { GameLog } from './GameLog';
import { Analytics } from './Analytics';
import { useHeard2H } from '../../hooks/useHeard2H';
import { computeAnalytics } from '../../lib/heard2h';
import type { PipelineResult } from '../../lib/heard2h/types';

const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

type SubView = 'analyze' | 'log' | 'analytics';

export function Heard2HTab() {
  const [view, setView] = useState<SubView>('analyze');
  const [result, setResult] = useState<PipelineResult | null>(null);
  const { games, loading, error, saveGame, updateGame } = useHeard2H();

  const handleSave = async () => {
    if (!result) return;
    try {
      await saveGame({ input: result.input, result });
      setResult(null);
      setView('log');
    } catch (err: any) {
      alert('Failed to save: ' + err.message);
    }
  };

  const tabBtn = (v: SubView, _label?: string) => ({
    background: view === v ? '#2563eb' : 'transparent',
    border: view === v ? 'none' : '1px solid rgba(255,255,255,0.12)',
    color: view === v ? '#fff' : '#94a3b8',
    borderRadius: '8px', padding: '6px 14px', cursor: 'pointer',
    fontWeight: 900, fontSize: '11px', fontFamily: FONT,
  });

  const analytics = computeAnalytics(games);

  return (
    <div style={{ padding: '20px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ margin: 0, color: '#f8fafc', fontSize: '26px', fontWeight: 900, fontFamily: FONT }}>
            2H Analysis
          </h2>
          <div style={{ color: '#94a3b8', fontSize: '13px', fontWeight: 700, marginTop: '4px' }}>
            Halftime mispricing detection — MIP + Tempo + Signals
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button style={tabBtn('analyze', 'Analyze')} onClick={() => setView('analyze')}>Analyze</button>
          <button style={tabBtn('log', 'Game Log')} onClick={() => setView('log')}>
            Game Log {games.length > 0 && `(${games.length})`}
          </button>
          <button style={tabBtn('analytics', 'Analytics')} onClick={() => setView('analytics')}>Analytics</button>
        </div>
      </div>

      {error && <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: '12px', fontSize: '13px' }}>{error}</div>}

      {view === 'analyze' && (
        <div style={{ display: 'grid', gridTemplateColumns: result ? '1fr 1fr' : '1fr', gap: '16px', alignItems: 'start' }}>
          <AnalysisForm onResult={setResult} />
          {result && <AnalysisResult result={result} onSave={handleSave} />}
        </div>
      )}

      {view === 'log' && (
        <GameLog games={games} loading={loading} onUpdate={updateGame} />
      )}

      {view === 'analytics' && (
        <Analytics analytics={analytics} />
      )}
    </div>
  );
}
