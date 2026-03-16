import { useState } from 'react';
import type { GameInput, Sport, SharpSide, SharpTotal, GameState, TovType, PipelineResult } from '../../lib/heard2h/types';
import { runPipeline } from '../../lib/heard2h';

const FONT = '"Arial Black", "Segoe UI", Arial, sans-serif';

const labelStyle: React.CSSProperties = {
  fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
  color: '#94a3b8', fontWeight: 800, fontFamily: FONT, marginBottom: '4px',
};

const inputStyle: React.CSSProperties = {
  background: '#020617', border: '1px solid rgba(255,255,255,0.1)',
  color: '#e2e8f0', borderRadius: '8px', padding: '8px 10px',
  fontWeight: 700, fontFamily: FONT, fontSize: '13px', width: '100%',
  boxSizing: 'border-box',
};

const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' };

const checkboxRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 0',
};

const checkLabelStyle: React.CSSProperties = {
  color: '#cbd5e1', fontSize: '12px', fontWeight: 700, fontFamily: FONT, cursor: 'pointer',
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={labelStyle}>{label}</div>
      {children}
    </div>
  );
}

interface Props {
  onResult: (result: PipelineResult) => void;
}

export function AnalysisForm({ onResult }: Props) {
  const [mode, setMode] = useState<'fast' | 'full'>('fast');
  const [sport, setSport] = useState<Sport>('ncaab');

  // Core inputs
  const [homeTeam, setHomeTeam] = useState('');
  const [awayTeam, setAwayTeam] = useState('');
  const [pregameSpread, setPregameSpread] = useState('');
  const [pregameTotal, setPregameTotal] = useState('');
  const [firstHalfSpread, setFirstHalfSpread] = useState('');
  const [firstHalfTotal, setFirstHalfTotal] = useState('');
  const [htHome, setHtHome] = useState('');
  const [htAway, setHtAway] = useState('');
  const [shSpreadOpen, setShSpreadOpen] = useState('');
  const [shTotalOpen, setShTotalOpen] = useState('');
  const [shSpreadCurr, setShSpreadCurr] = useState('');
  const [shTotalCurr, setShTotalCurr] = useState('');
  const [sharpSide, setSharpSide] = useState<SharpSide>('');
  const [sharpTotal, setSharpTotal] = useState<SharpTotal>('');

  // Box score (full mode)
  const [favFga, setFavFga] = useState('');
  const [favOreb, setFavOreb] = useState('');
  const [favTov, setFavTov] = useState('');
  const [favFta, setFavFta] = useState('');
  const [favFouls, setFavFouls] = useState('');
  const [fav3pm, setFav3pm] = useState('');
  const [fav3pa, setFav3pa] = useState('');
  const [oppFga, setOppFga] = useState('');
  const [oppOreb, setOppOreb] = useState('');
  const [oppTov, setOppTov] = useState('');
  const [oppFta, setOppFta] = useState('');
  const [oppFouls, setOppFouls] = useState('');
  const [opp3pm, setOpp3pm] = useState('');
  const [opp3pa, setOpp3pa] = useState('');
  const [gameState, setGameState] = useState<GameState | ''>('');
  const [tovType, setTovType] = useState<TovType>('');

  // Confirmation checkboxes
  const [confirmSharpTotal, setConfirmSharpTotal] = useState(false);
  const [confirmNoStructural, setConfirmNoStructural] = useState(false);
  const [confirmMicroRlm, setConfirmMicroRlm] = useState(false);
  const [confirm2hSoft, setConfirm2hSoft] = useState(false);
  const [confirmSideRlm, setConfirmSideRlm] = useState(false);
  const [confirmNoFoulInjury, setConfirmNoFoulInjury] = useState(false);

  // Signal checkboxes
  const [signalRlm, setSignalRlm] = useState(false);
  const [signalStar, setSignalStar] = useState(false);
  const [signalFt, setSignalFt] = useState(false);
  const [signalPsych, setSignalPsych] = useState(false);

  const n = (v: string) => v === '' ? undefined : Number(v);
  const nr = (v: string) => Number(v) || 0;

  const handleAnalyze = () => {
    const input: GameInput = {
      game_id: `${awayTeam}_${homeTeam}_${new Date().toISOString().slice(0, 10)}`,
      date: new Date().toISOString().slice(0, 10),
      sport,
      home_team: homeTeam,
      away_team: awayTeam,
      sharp_side: sharpSide,
      sharp_total: sharpTotal,
      location: 'home',
      pregame_spread: nr(pregameSpread),
      pregame_total: nr(pregameTotal),
      first_half_spread: nr(firstHalfSpread),
      first_half_total: nr(firstHalfTotal),
      ht_home_score: nr(htHome),
      ht_away_score: nr(htAway),
      sh_spread_open: nr(shSpreadOpen),
      sh_total_open: nr(shTotalOpen),
      sh_spread_curr: shSpreadCurr ? nr(shSpreadCurr) : nr(shSpreadOpen),
      sh_total_curr: shTotalCurr ? nr(shTotalCurr) : nr(shTotalOpen),
      // Box score (full mode)
      ...(mode === 'full' ? {
        fav_fga: n(favFga), fav_oreb: n(favOreb), fav_tov: n(favTov),
        fav_fta: n(favFta), fav_fouls: n(favFouls), fav_3pm: n(fav3pm), fav_3pa: n(fav3pa),
        opp_fga: n(oppFga), opp_oreb: n(oppOreb), opp_tov: n(oppTov),
        opp_fta: n(oppFta), opp_fouls: n(oppFouls), opp_3pm: n(opp3pm), opp_3pa: n(opp3pa),
        game_state: (gameState || undefined) as GameState | undefined,
        tov_type: (tovType || undefined) as TovType | undefined,
      } : {}),
      // Confirmations
      confirm_sharp_total_aligns: confirmSharpTotal,
      confirm_no_structural_reason: confirmNoStructural,
      confirm_micro_rlm: confirmMicroRlm,
      confirm_2h_line_soft: confirm2hSoft,
      confirm_side_rlm: confirmSideRlm,
      confirm_no_foul_injury: confirmNoFoulInjury,
      // Signals
      signal_rlm_confirmed: signalRlm,
      signal_star_returning: signalStar,
      signal_ft_differential: signalFt,
      signal_psych_spot: signalPsych,
    };

    const result = runPipeline(input);
    onResult(result);
  };

  const modeBtn = (m: 'fast' | 'full') => ({
    background: mode === m ? '#2563eb' : 'transparent',
    border: mode === m ? 'none' : '1px solid rgba(255,255,255,0.12)',
    color: mode === m ? '#fff' : '#94a3b8',
    borderRadius: '8px', padding: '6px 14px', cursor: 'pointer',
    fontWeight: 900, fontSize: '11px', fontFamily: FONT,
  });

  const sportBtn = (s: Sport) => ({
    background: sport === s ? '#7c3aed' : 'transparent',
    border: sport === s ? 'none' : '1px solid rgba(255,255,255,0.12)',
    color: sport === s ? '#fff' : '#94a3b8',
    borderRadius: '8px', padding: '6px 14px', cursor: 'pointer',
    fontWeight: 900, fontSize: '11px', fontFamily: FONT,
  });

  return (
    <div style={{ background: '#111827', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)', padding: '20px' }}>
      {/* Mode + Sport toggles */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button style={modeBtn('fast')} onClick={() => setMode('fast')}>Fast Mode</button>
        <button style={modeBtn('full')} onClick={() => setMode('full')}>Full Mode</button>
        <div style={{ width: '1px', background: 'rgba(255,255,255,0.1)', margin: '0 4px' }} />
        <button style={sportBtn('ncaab')} onClick={() => setSport('ncaab')}>NCAAB</button>
        <button style={sportBtn('nba')} onClick={() => setSport('nba')}>NBA</button>
      </div>

      {/* Teams */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
        <Field label="Away Team">
          <input style={inputStyle} value={awayTeam} onChange={e => setAwayTeam(e.target.value)} placeholder="Away" />
        </Field>
        <Field label="Home Team">
          <input style={inputStyle} value={homeTeam} onChange={e => setHomeTeam(e.target.value)} placeholder="Home" />
        </Field>
      </div>

      {/* Pre-game lines */}
      <div style={labelStyle}>Pre-Game Closing Lines</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
        <Field label="Spread (neg = home fav)">
          <input style={inputStyle} type="number" step="0.5" value={pregameSpread} onChange={e => setPregameSpread(e.target.value)} placeholder="-3.5" />
        </Field>
        <Field label="Total">
          <input style={inputStyle} type="number" step="0.5" value={pregameTotal} onChange={e => setPregameTotal(e.target.value)} placeholder="230.5" />
        </Field>
      </div>

      {/* 1H lines */}
      <div style={labelStyle}>1H Closing Lines</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
        <Field label="1H Spread">
          <input style={inputStyle} type="number" step="0.5" value={firstHalfSpread} onChange={e => setFirstHalfSpread(e.target.value)} placeholder="-1.5" />
        </Field>
        <Field label="1H Total">
          <input style={inputStyle} type="number" step="0.5" value={firstHalfTotal} onChange={e => setFirstHalfTotal(e.target.value)} placeholder="112.5" />
        </Field>
      </div>

      {/* Halftime scores */}
      <div style={labelStyle}>Halftime Score</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
        <Field label="Home Score">
          <input style={inputStyle} type="number" value={htHome} onChange={e => setHtHome(e.target.value)} placeholder="54" />
        </Field>
        <Field label="Away Score">
          <input style={inputStyle} type="number" value={htAway} onChange={e => setHtAway(e.target.value)} placeholder="49" />
        </Field>
      </div>

      {/* 2H lines */}
      <div style={labelStyle}>2H Lines</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
        <Field label="2H Spread (Opener)">
          <input style={inputStyle} type="number" step="0.5" value={shSpreadOpen} onChange={e => setShSpreadOpen(e.target.value)} placeholder="-1.0" />
        </Field>
        <Field label="2H Total (Opener)">
          <input style={inputStyle} type="number" step="0.5" value={shTotalOpen} onChange={e => setShTotalOpen(e.target.value)} placeholder="117.0" />
        </Field>
        <Field label="2H Spread (Current)">
          <input style={inputStyle} type="number" step="0.5" value={shSpreadCurr} onChange={e => setShSpreadCurr(e.target.value)} placeholder="Same as opener" />
        </Field>
        <Field label="2H Total (Current)">
          <input style={inputStyle} type="number" step="0.5" value={shTotalCurr} onChange={e => setShTotalCurr(e.target.value)} placeholder="Same as opener" />
        </Field>
      </div>

      {/* Sharp info */}
      <div style={labelStyle}>Sharp Action</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
        <Field label="Sharp Side">
          <select style={selectStyle} value={sharpSide} onChange={e => setSharpSide(e.target.value as SharpSide)}>
            <option value="">None</option>
            <option value="fav">Favorite</option>
            <option value="dog">Dog</option>
          </select>
        </Field>
        <Field label="Sharp Total">
          <select style={selectStyle} value={sharpTotal} onChange={e => setSharpTotal(e.target.value as SharpTotal)}>
            <option value="">None</option>
            <option value="over">Over</option>
            <option value="under">Under</option>
          </select>
        </Field>
      </div>

      {/* MIP Confirmation Checkboxes */}
      <div style={{ ...labelStyle, marginBottom: '8px' }}>Confirmation Signals</div>
      <div style={{ background: '#020617', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
        <div style={{ ...labelStyle, color: '#64748b', fontSize: '9px' }}>Totals</div>
        <label style={checkboxRowStyle}>
          <input type="checkbox" checked={confirmSharpTotal} onChange={e => setConfirmSharpTotal(e.target.checked)} />
          <span style={checkLabelStyle}>Sharp total aligns with 2H read</span>
        </label>
        <label style={checkboxRowStyle}>
          <input type="checkbox" checked={confirmNoStructural} onChange={e => setConfirmNoStructural(e.target.checked)} />
          <span style={checkLabelStyle}>No structural reason for adjustment</span>
        </label>
        <label style={checkboxRowStyle}>
          <input type="checkbox" checked={confirmMicroRlm} onChange={e => setConfirmMicroRlm(e.target.checked)} />
          <span style={checkLabelStyle}>Micro-RLM / juice confirms in HT window</span>
        </label>
        <div style={{ ...labelStyle, color: '#64748b', fontSize: '9px', marginTop: '6px' }}>Sides</div>
        <label style={checkboxRowStyle}>
          <input type="checkbox" checked={confirm2hSoft} onChange={e => setConfirm2hSoft(e.target.checked)} />
          <span style={checkLabelStyle}>2H line too soft vs pregame power rating</span>
        </label>
        <label style={checkboxRowStyle}>
          <input type="checkbox" checked={confirmSideRlm} onChange={e => setConfirmSideRlm(e.target.checked)} />
          <span style={checkLabelStyle}>Micro-RLM / juice confirms side</span>
        </label>
        <label style={checkboxRowStyle}>
          <input type="checkbox" checked={confirmNoFoulInjury} onChange={e => setConfirmNoFoulInjury(e.target.checked)} />
          <span style={checkLabelStyle}>No foul/injury reason against the side</span>
        </label>
      </div>

      {/* Full mode: box score inputs */}
      {mode === 'full' && (
        <>
          <div style={labelStyle}>1H Box Score — Favorite</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
            <Field label="FGA"><input style={inputStyle} type="number" value={favFga} onChange={e => setFavFga(e.target.value)} /></Field>
            <Field label="OREB"><input style={inputStyle} type="number" value={favOreb} onChange={e => setFavOreb(e.target.value)} /></Field>
            <Field label="TOV"><input style={inputStyle} type="number" value={favTov} onChange={e => setFavTov(e.target.value)} /></Field>
            <Field label="FTA"><input style={inputStyle} type="number" value={favFta} onChange={e => setFavFta(e.target.value)} /></Field>
            <Field label="Fouls"><input style={inputStyle} type="number" value={favFouls} onChange={e => setFavFouls(e.target.value)} /></Field>
            <Field label="3PM"><input style={inputStyle} type="number" value={fav3pm} onChange={e => setFav3pm(e.target.value)} /></Field>
            <Field label="3PA"><input style={inputStyle} type="number" value={fav3pa} onChange={e => setFav3pa(e.target.value)} /></Field>
          </div>

          <div style={labelStyle}>1H Box Score — Opponent</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '14px' }}>
            <Field label="FGA"><input style={inputStyle} type="number" value={oppFga} onChange={e => setOppFga(e.target.value)} /></Field>
            <Field label="OREB"><input style={inputStyle} type="number" value={oppOreb} onChange={e => setOppOreb(e.target.value)} /></Field>
            <Field label="TOV"><input style={inputStyle} type="number" value={oppTov} onChange={e => setOppTov(e.target.value)} /></Field>
            <Field label="FTA"><input style={inputStyle} type="number" value={oppFta} onChange={e => setOppFta(e.target.value)} /></Field>
            <Field label="Fouls"><input style={inputStyle} type="number" value={oppFouls} onChange={e => setOppFouls(e.target.value)} /></Field>
            <Field label="3PM"><input style={inputStyle} type="number" value={opp3pm} onChange={e => setOpp3pm(e.target.value)} /></Field>
            <Field label="3PA"><input style={inputStyle} type="number" value={opp3pa} onChange={e => setOpp3pa(e.target.value)} /></Field>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
            <Field label="Game State">
              <select style={selectStyle} value={gameState} onChange={e => setGameState(e.target.value as GameState | '')}>
                <option value="">Auto-detect</option>
                <option value="close">Close (≤5 pts)</option>
                <option value="moderate">Moderate</option>
                <option value="blowout">Blowout (≥15 pts)</option>
              </select>
            </Field>
            <Field label="Turnover Type">
              <select style={selectStyle} value={tovType} onChange={e => setTovType(e.target.value as TovType)}>
                <option value="">Unspecified</option>
                <option value="sloppy">Sloppy (unforced)</option>
                <option value="structural">Structural (press/pressure)</option>
              </select>
            </Field>
          </div>

          {/* Signal checkboxes */}
          <div style={{ ...labelStyle, marginBottom: '8px' }}>Context Signals (Manual)</div>
          <div style={{ background: '#020617', borderRadius: '10px', padding: '10px 14px', marginBottom: '14px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={signalRlm} onChange={e => setSignalRlm(e.target.checked)} />
              <span style={checkLabelStyle}>2H Reverse Line Movement confirmed (+3)</span>
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={signalStar} onChange={e => setSignalStar(e.target.checked)} />
              <span style={checkLabelStyle}>Star returning from foul trouble (+1)</span>
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={signalFt} onChange={e => setSignalFt(e.target.checked)} />
              <span style={checkLabelStyle}>FT differential normalizing (+1)</span>
            </label>
            <label style={checkboxRowStyle}>
              <input type="checkbox" checked={signalPsych} onChange={e => setSignalPsych(e.target.checked)} />
              <span style={checkLabelStyle}>Psychological spot (+{sport === 'ncaab' ? '2' : '1'})</span>
            </label>
          </div>
        </>
      )}

      {/* Analyze button */}
      <button
        onClick={handleAnalyze}
        style={{
          width: '100%', background: '#2563eb', border: 'none', color: '#fff',
          borderRadius: '10px', padding: '12px', cursor: 'pointer',
          fontWeight: 900, fontSize: '14px', fontFamily: FONT,
        }}
      >
        Analyze
      </button>
    </div>
  );
}
