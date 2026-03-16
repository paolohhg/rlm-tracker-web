import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useGamesFeed } from '../hooks/useGamesFeed';
import { useGenerateHsa } from '../hooks/useGenerateHsa';
import { useHMCycles } from '../hooks/useHMCycles';
import type { GameView } from '../types';

type StatusFilter = 'all' | 'upcoming' | 'live' | 'final';

function isAlertSignal(signalTier: string | null | undefined) {
  return !!signalTier && signalTier !== 'WATCH' && signalTier !== 'TRACKING';
}

function getSignalRank(signalTier: string | null | undefined) {
  switch (signalTier) {
    case 'DOUBLE NO-NARRATIVE RLM':
      return 5;
    case 'NO-NARRATIVE RLM':
      return 4;
    case 'STEAM MOVE':
      return 3;
    case 'FROZEN LINE':
      return 2;
    case 'BOOK SHADE':
    case 'CONTRA MOVE':
      return 1;
    case 'WATCH':
      return 0;
    case 'TRACKING':
    default:
      return -1;
  }
}

function formatTimeToTip(minutes: number) {
  if (minutes <= 0) return 'Started';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h ${m}m`;
}

function formatGameTime(gameTime: string) {
  try {
    return new Date(gameTime).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return gameTime;
  }
}

function statusColor(status: string) {
  switch (status) {
    case 'live':
      return '#16a34a';
    case 'final':
      return '#64748b';
    case 'upcoming':
    default:
      return '#2563eb';
  }
}

function signalColor(signalTier: string | null | undefined) {
  switch (signalTier) {
    case 'DOUBLE NO-NARRATIVE RLM':
      return '#dc2626';
    case 'NO-NARRATIVE RLM':
      return '#ea580c';
    case 'STEAM MOVE':
      return '#d97706';
    case 'FROZEN LINE':
      return '#7c3aed';
    case 'BOOK SHADE':
    case 'CONTRA MOVE':
      return '#0891b2';
    case 'WATCH':
      return '#eab308';
    case 'TRACKING':
    default:
      return '#475569';
  }
}

function summaryValueStyle() {
  return {
    fontSize: '22px',
    fontWeight: 900 as const,
    color: '#f8fafc',
    fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
  };
}

function cardLabelStyle() {
  return {
    fontSize: '11px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: '#94a3b8',
    fontWeight: 800 as const,
    fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
  };
}

function normalizeKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getNbaLogoUrl(teamName: string) {
  const logos: Record<string, string> = {
    atlantahawks: 'https://a.espncdn.com/i/teamlogos/nba/500/atl.png',
    bostonceltics: 'https://a.espncdn.com/i/teamlogos/nba/500/bos.png',
    brooklynnets: 'https://a.espncdn.com/i/teamlogos/nba/500/bkn.png',
    charlottehornets: 'https://a.espncdn.com/i/teamlogos/nba/500/cha.png',
    chicagobulls: 'https://a.espncdn.com/i/teamlogos/nba/500/chi.png',
    clevelandcavaliers: 'https://a.espncdn.com/i/teamlogos/nba/500/cle.png',
    dallasmavericks: 'https://a.espncdn.com/i/teamlogos/nba/500/dal.png',
    denvernuggets: 'https://a.espncdn.com/i/teamlogos/nba/500/den.png',
    detroitpistons: 'https://a.espncdn.com/i/teamlogos/nba/500/det.png',
    goldenstatewarriors: 'https://a.espncdn.com/i/teamlogos/nba/500/gs.png',
    houstonrockets: 'https://a.espncdn.com/i/teamlogos/nba/500/hou.png',
    indianapacers: 'https://a.espncdn.com/i/teamlogos/nba/500/ind.png',
    laclippers: 'https://a.espncdn.com/i/teamlogos/nba/500/lac.png',
    losangelesclippers: 'https://a.espncdn.com/i/teamlogos/nba/500/lac.png',
    losangeleslakers: 'https://a.espncdn.com/i/teamlogos/nba/500/lal.png',
    memphisgrizzlies: 'https://a.espncdn.com/i/teamlogos/nba/500/mem.png',
    miamiheat: 'https://a.espncdn.com/i/teamlogos/nba/500/mia.png',
    milwaukeebucks: 'https://a.espncdn.com/i/teamlogos/nba/500/mil.png',
    minnesotatimberwolves: 'https://a.espncdn.com/i/teamlogos/nba/500/min.png',
    neworleanspelicans: 'https://a.espncdn.com/i/teamlogos/nba/500/no.png',
    newyorkknicks: 'https://a.espncdn.com/i/teamlogos/nba/500/ny.png',
    oklahomacitythunder: 'https://a.espncdn.com/i/teamlogos/nba/500/okc.png',
    orlandomagic: 'https://a.espncdn.com/i/teamlogos/nba/500/orl.png',
    philadelphia76ers: 'https://a.espncdn.com/i/teamlogos/nba/500/phi.png',
    phoenixsuns: 'https://a.espncdn.com/i/teamlogos/nba/500/phx.png',
    portlandtrailblazers: 'https://a.espncdn.com/i/teamlogos/nba/500/por.png',
    sacramentokings: 'https://a.espncdn.com/i/teamlogos/nba/500/sac.png',
    sanantoniospurs: 'https://a.espncdn.com/i/teamlogos/nba/500/sa.png',
    torontoraptors: 'https://a.espncdn.com/i/teamlogos/nba/500/tor.png',
    utahjazz: 'https://a.espncdn.com/i/teamlogos/nba/500/utah.png',
    washingtonwizards: 'https://a.espncdn.com/i/teamlogos/nba/500/wsh.png',
  };

  return logos[normalizeKey(teamName)] ?? null;
}

// Module-level cache — fetched once, reused across renders
let ncaabLogoCache: Record<string, string> | null = null;
let ncaabLogoCachePromise: Promise<Record<string, string>> | null = null;

function fetchNcaabLogoMap(): Promise<Record<string, string>> {
  if (ncaabLogoCache) return Promise.resolve(ncaabLogoCache);
  if (!ncaabLogoCachePromise) {
    ncaabLogoCachePromise = fetch(
      'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/teams?limit=500'
    )
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, string> = {};
        for (const entry of data.sports?.[0]?.leagues?.[0]?.teams ?? []) {
          const team = entry.team;
          const logo = team.logos?.[0]?.href ?? null;
          if (logo) {
            map[normalizeKey(team.displayName)] = logo;
            if (team.shortDisplayName) map[normalizeKey(team.shortDisplayName)] = logo;
            if (team.nickname) map[normalizeKey(team.nickname)] = logo;
          }
        }
        ncaabLogoCache = map;
        console.log('[logos] NCAAB map built, teams:', Object.keys(map).length, 'sample:', Object.keys(map).slice(0, 5));
        return map;
      })
      .catch((e) => { console.error('[logos] ESPN fetch failed:', e); return {}; });
  }
  return ncaabLogoCachePromise;
}

function getTeamLogo(league: string, teamName: string, ncaabLogos: Record<string, string>) {
  const l = league.toUpperCase();
  if (l === 'NBA') return getNbaLogoUrl(teamName);
  if (l === 'NCAAB') return ncaabLogos[normalizeKey(teamName)] ?? null;
  return null;
}

function getTeamInitials(teamName: string) {
  return teamName
    .split(' ')
    .map((word) => word[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
}

function TeamBadge({ league, teamName, ncaabLogos }: { league: string; teamName: string; ncaabLogos: Record<string, string> }) {
  const logo = getTeamLogo(league, teamName, ncaabLogos);

  if (logo) {
    return (
      <img
        src={logo}
        alt={teamName}
        style={{
          width: '36px',
          height: '36px',
          objectFit: 'contain',
          borderRadius: '999px',
          background: '#fff',
          padding: '3px',
        }}
      />
    );
  }

  return (
    <div
      style={{
        width: '36px',
        height: '36px',
        borderRadius: '999px',
        background: '#1e293b',
        color: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '11px',
        fontWeight: 900,
        fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
      }}
    >
      {getTeamInitials(teamName)}
    </div>
  );
}

function HsaModal({ game, onClose, onRefresh }: { game: GameView; onClose: () => void; onRefresh: () => void }) {
  const [localNarrative, setLocalNarrative] = useState<string | null>(game.hsaNarrative);
  const { generate, loading, error } = useGenerateHsa(onRefresh);

  const handleGenerate = useCallback(async (forceRefresh = false) => {
    const result = await generate({
      league: game.league,
      home_team: game.homeTeam,
      away_team: game.awayTeam,
      game_time: game.gameTime,
      force: forceRefresh || !!localNarrative,
    });
    if (result?.narrative) {
      setLocalNarrative(result.narrative);
    }
  }, [generate, game, localNarrative]);

  const narrative = localNarrative;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.7)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#111827',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: '16px',
          padding: '24px',
          maxWidth: '600px',
          width: '100%',
          maxHeight: '80vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              Heard Sports Analysis
            </div>
            <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '17px', marginTop: '6px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              {game.awayTeam} @ {game.homeTeam}
            </div>
            <div style={{ color: '#64748b', fontSize: '12px', marginTop: '4px', fontWeight: 700, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              {game.league} • {game.signalTier}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: '#1e293b',
              border: 'none',
              color: '#94a3b8',
              borderRadius: '999px',
              width: '32px',
              height: '32px',
              cursor: 'pointer',
              fontWeight: 900,
              fontSize: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>

        {narrative ? (
          <div>
            <div
              style={{
                color: '#e2e8f0',
                fontSize: '14px',
                lineHeight: 1.7,
                fontWeight: 600,
                fontFamily: '"Segoe UI", Arial, sans-serif',
                whiteSpace: 'pre-wrap',
              }}
            >
              {narrative}
            </div>
            {error && (
              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px', fontWeight: 600 }}>
                {error}
              </div>
            )}
            <button
              onClick={() => handleGenerate(true)}
              disabled={loading}
              style={{
                marginTop: '12px',
                background: 'transparent',
                border: '1px solid #334155',
                color: '#94a3b8',
                borderRadius: '8px',
                padding: '6px 14px',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {loading ? 'Refreshing...' : 'Refresh Analysis'}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ color: '#64748b', fontSize: '14px', fontWeight: 700, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', marginBottom: '16px' }}>
              No analysis available for this game yet.
            </div>
            <button
              onClick={() => handleGenerate()}
              disabled={loading}
              style={{
                background: loading ? '#1e40af' : '#2563eb',
                border: 'none',
                color: '#fff',
                borderRadius: '10px',
                padding: '12px 24px',
                cursor: loading ? 'wait' : 'pointer',
                fontWeight: 800,
                fontSize: '14px',
                fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
                transition: 'background 0.15s',
              }}
            >
              {loading ? 'Generating HSA...' : 'Generate HSA'}
            </button>
            {error && (
              <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px', fontWeight: 600 }}>
                {error}
              </div>
            )}
          </div>
        )}

        <div style={{ color: '#475569', fontSize: '11px', marginTop: '16px', fontWeight: 700, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
          For informational and research purposes only.
        </div>
      </div>
    </div>
  );
}

function GameCard({ game, ncaabLogos, onOpenHsa, onLogCycle }: { game: GameView; ncaabLogos: Record<string, string>; onOpenHsa: (game: GameView) => void; onLogCycle: (game: GameView) => void }) {
  const signalBg = signalColor(game.signalTier);

  return (
    <div
      style={{
        background: '#111827',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: '14px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', alignItems: 'flex-start' }}>
        <div>
          <div
            style={{
              color: '#f8fafc',
              fontWeight: 900,
              fontSize: '17px',
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            {game.awayTeam} @ {game.homeTeam}
          </div>
          <div
            style={{
              color: '#94a3b8',
              fontSize: '12px',
              marginTop: '4px',
              fontWeight: 700,
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            {game.league} • {formatGameTime(game.gameTime)}
          </div>
        </div>

        <div
          style={{
            background: statusColor(game.status),
            color: '#fff',
            fontSize: '11px',
            fontWeight: 900,
            textTransform: 'uppercase',
            padding: '5px 8px',
            borderRadius: '999px',
            whiteSpace: 'nowrap',
            fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
          }}
        >
          {game.status}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          gap: '10px',
          alignItems: 'center',
          background: '#020617',
          borderRadius: '12px',
          padding: '12px',
        }}
      >
        {/* Away team */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <TeamBadge league={game.league} teamName={game.awayTeam} ncaabLogos={ncaabLogos} />
          <div style={{ minWidth: 0 }}>
            <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              {game.awayTeam}
            </div>
            {(game.status === 'live' || game.status === 'final') && game.awayScore !== null && (
              <div style={{ color: game.status === 'live' ? '#22c55e' : '#f8fafc', fontWeight: 900, fontSize: '26px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', lineHeight: 1 }}>
                {game.awayScore}
              </div>
            )}
          </div>
        </div>

        {/* Middle */}
        <div style={{ textAlign: 'center' }}>
          {game.status === 'live' && game.period ? (
            <div style={{ color: '#22c55e', fontWeight: 900, fontSize: '11px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              <div>Q{game.period}</div>
              {game.gameClock && <div>{game.gameClock}</div>}
            </div>
          ) : game.status === 'final' ? (
            <div style={{ color: '#64748b', fontWeight: 900, fontSize: '11px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>FINAL</div>
          ) : (
            <div style={{ color: '#64748b', fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>@</div>
          )}
        </div>

        {/* Home team */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', minWidth: 0 }}>
          <div style={{ minWidth: 0, textAlign: 'right' }}>
            <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              {game.homeTeam}
            </div>
            {(game.status === 'live' || game.status === 'final') && game.homeScore !== null && (
              <div style={{ color: game.status === 'live' ? '#22c55e' : '#f8fafc', fontWeight: 900, fontSize: '26px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', lineHeight: 1, textAlign: 'right' }}>
                {game.homeScore}
              </div>
            )}
          </div>
          <TeamBadge league={game.league} teamName={game.homeTeam} ncaabLogos={ncaabLogos} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <div
          style={{
            background: signalBg,
            color: '#fff',
            fontSize: '11px',
            fontWeight: 900,
            padding: '6px 9px',
            borderRadius: '999px',
            fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
          }}
        >
          {game.signalTier}
        </div>

        {game.sharpTeam ? (
          <div
            style={{
              background: '#1e293b',
              color: '#e2e8f0',
              fontSize: '11px',
              fontWeight: 900,
              padding: '6px 9px',
              borderRadius: '999px',
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            Sharp: {game.sharpTeam}
          </div>
        ) : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '12px' }}>
        <div>
          <div style={cardLabelStyle()}>Time</div>
          <div
            style={{
              color: '#f8fafc',
              fontWeight: 900,
              marginTop: '4px',
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            {game.status === 'upcoming'
              ? `Tips in ${formatTimeToTip(game.timeToTipMinutes)}`
              : game.status === 'live'
                ? 'In Progress'
                : 'Final'}
          </div>
        </div>

        <div>
          <div style={cardLabelStyle()}>Line Move</div>
          <div
            style={{
              color: '#f8fafc',
              fontWeight: 900,
              marginTop: '4px',
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            {game.lineMoveAmount !== null && game.lineMoveAmount !== undefined
              ? `${game.lineMoveAmount > 0 ? '+' : ''}${game.lineMoveAmount}`
              : '—'}
          </div>
        </div>

        <div>
          <div style={cardLabelStyle()}>Open</div>
          <div
            style={{
              color: '#f8fafc',
              fontWeight: 900,
              marginTop: '4px',
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            {game.openingSpread ?? '—'}
          </div>
        </div>

        <div>
          <div style={cardLabelStyle()}>Current</div>
          <div
            style={{
              color: '#f8fafc',
              fontWeight: 900,
              marginTop: '4px',
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            {game.currentSpread ?? '—'}
          </div>
        </div>
      </div>

      {/* Totals */}
      {(game.openingTotal !== null || game.currentTotal !== null) && (
        <div style={{ padding: '6px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={cardLabelStyle()}>Total</div>
              {game.totalSignalType && (
                <span style={{
                  fontSize: '9px',
                  fontWeight: 900,
                  color: game.totalSignalType.includes('STEAM') ? '#d97706' : '#ea580c',
                  background: game.totalSignalType.includes('STEAM') ? 'rgba(217,119,6,0.15)' : 'rgba(234,88,12,0.15)',
                  padding: '1px 6px',
                  borderRadius: '4px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
                }}>
                  {game.totalSignalType.replace(/_/g, ' ')}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 700, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
                {game.openingTotal ?? '—'}
              </span>
              <span style={{ color: '#475569', fontSize: '11px' }}>→</span>
              <span style={{ color: '#f8fafc', fontSize: '12px', fontWeight: 900, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
                {game.currentTotal ?? '—'}
              </span>
              {game.openingTotal !== null && game.currentTotal !== null && game.currentTotal !== game.openingTotal && (
                <span style={{
                  color: game.currentTotal > game.openingTotal ? '#22c55e' : '#ef4444',
                  fontSize: '11px',
                  fontWeight: 800,
                  fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
                }}>
                  {game.currentTotal > game.openingTotal ? '↑' : '↓'} {Math.abs(game.currentTotal - game.openingTotal).toFixed(1)}
                </span>
              )}
            </div>
          </div>
          {/* Totals splits */}
          {game.overTicketPct !== null && game.underTicketPct !== null && (
            <div style={{ marginTop: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontWeight: 800, marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span>O/U Tickets</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 800, minWidth: '32px', textAlign: 'right' }}>{game.overTicketPct}%</div>
                <div style={{ flex: 1, display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: '#1e293b' }}>
                  <div style={{ width: `${game.overTicketPct}%`, background: '#22c55e', transition: 'width 0.3s' }} />
                  <div style={{ width: `${game.underTicketPct}%`, background: '#ef4444', transition: 'width 0.3s' }} />
                </div>
                <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 800, minWidth: '32px' }}>{game.underTicketPct}%</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#64748b', fontWeight: 700, marginTop: '1px' }}>
                <span>Over</span>
                <span>Under</span>
              </div>
            </div>
          )}
          {game.overMoneyPct !== null && game.underMoneyPct !== null && (game.overMoneyPct > 0 || game.underMoneyPct > 0) && (
            <div style={{ marginTop: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontWeight: 800, marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span>O/U Money</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 800, minWidth: '32px', textAlign: 'right' }}>{game.overMoneyPct}%</div>
                <div style={{ flex: 1, display: 'flex', height: '6px', borderRadius: '3px', overflow: 'hidden', background: '#1e293b' }}>
                  <div style={{ width: `${game.overMoneyPct}%`, background: '#22c55e', transition: 'width 0.3s' }} />
                  <div style={{ width: `${game.underMoneyPct}%`, background: '#ef4444', transition: 'width 0.3s' }} />
                </div>
                <div style={{ fontSize: '10px', color: '#94a3b8', fontWeight: 800, minWidth: '32px' }}>{game.underMoneyPct}%</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: '#64748b', fontWeight: 700, marginTop: '1px' }}>
                <span>Over</span>
                <span>Under</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Betting splits */}
      {(game.publicBetsPct !== null || game.publicMoneyPct !== null || game.booksAgreeing !== null) && (() => {
        const shortName = (name: string) => {
          const parts = name.split(' ');
          if (parts.length <= 2) return parts[0];
          // NBA: "Los Angeles Lakers" → "Los Angeles"; NCAAB: drop last word (mascot)
          // For NCAAB 3+ word names: "Ole Miss Rebels" → "Ole Miss", "Alabama Crimson Tide" → "Alabama Crimson"
          return parts.slice(0, -1).join(' ');
        };
        const awayShort = shortName(game.awayTeam);
        const homeShort = shortName(game.homeTeam);
        const awayBets = game.awayBetsPct ?? (game.publicBetsPct != null ? 100 - game.publicBetsPct : null);
        const homeBets = game.publicBetsPct;
        const awayMoney = game.awayMoneyPct ?? (game.publicMoneyPct != null ? 100 - game.publicMoneyPct : null);
        const homeMoney = game.publicMoneyPct;
        return (
        <div style={{ background: '#020617', borderRadius: '10px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={cardLabelStyle()}>Betting Splits</div>
            {game.numBets != null && (
              <div style={{ fontSize: '10px', color: '#475569', fontWeight: 700 }}>{game.numBets.toLocaleString()} bets</div>
            )}
          </div>
          {homeBets !== null && awayBets !== null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontWeight: 800, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span>Tickets</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 800, minWidth: '32px', textAlign: 'right' }}>{awayBets}%</div>
                <div style={{ flex: 1, display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: '#1e293b' }}>
                  <div style={{ width: `${awayBets}%`, background: '#3b82f6', transition: 'width 0.3s' }} />
                  <div style={{ width: `${homeBets}%`, background: '#8b5cf6', transition: 'width 0.3s' }} />
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 800, minWidth: '32px' }}>{homeBets}%</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontWeight: 700, marginTop: '2px' }}>
                <span>{awayShort}</span>
                <span>{homeShort}</span>
              </div>
            </div>
          )}
          {homeMoney !== null && awayMoney !== null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontWeight: 800, marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                <span>Money</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 800, minWidth: '32px', textAlign: 'right' }}>{awayMoney}%</div>
                <div style={{ flex: 1, display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', background: '#1e293b' }}>
                  <div style={{ width: `${awayMoney}%`, background: '#3b82f6', transition: 'width 0.3s' }} />
                  <div style={{ width: `${homeMoney}%`, background: '#8b5cf6', transition: 'width 0.3s' }} />
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 800, minWidth: '32px' }}>{homeMoney}%</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b', fontWeight: 700, marginTop: '2px' }}>
                <span>{awayShort}</span>
                <span>{homeShort}</span>
              </div>
            </div>
          )}
          {game.booksAgreeing !== null && game.totalBooks !== null && (
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>
              {game.booksAgreeing}/{game.totalBooks} books agreeing{game.velocityPerHour !== null ? ` • ${game.velocityPerHour}/hr velocity` : ''}
            </div>
          )}
        </div>
        );
      })()}

      {/* Log HM Cycle button — always visible */}
      <button
        onClick={() => onLogCycle(game)}
        style={{
          background: 'transparent',
          border: '1px solid rgba(139,92,246,0.4)',
          color: '#a78bfa',
          borderRadius: '10px',
          padding: '8px 12px',
          cursor: 'pointer',
          fontWeight: 900,
          fontSize: '12px',
          fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
          width: '100%',
          textAlign: 'center' as const,
        }}
      >
        + Log HM Cycle
      </button>

      <div
        onClick={() => onOpenHsa(game)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={cardLabelStyle()}>Intel</div>
          {game.hsaNarrative && (
            <div style={{ fontSize: '10px', color: '#7c3aed', fontWeight: 900, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              HSA AVAILABLE →
            </div>
          )}
        </div>
        <div
          style={{
            color: '#cbd5e1',
            fontSize: '13px',
            marginTop: '4px',
            lineHeight: 1.45,
            fontWeight: 700,
            fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
          }}
        >
          {game.hsaSnippet ?? 'No score or narrative yet'}
        </div>
      </div>

      {/* Bet suggestion from HSA */}
      {game.hsaNarrative && (() => {
        const sharpMatch = game.hsaNarrative.match(/5\.\s*Sharp Read:\s*(.*?)(?=\n\n|\n6\.)/s);
        if (!sharpMatch) return null;
        const sharpText = sharpMatch[1].trim();
        const isPass = /NO EDGE|PASS/i.test(sharpText);
        const betMatch = sharpText.match(/(?:on\s+|[-–—]\s*)([\w\s.'']+?)\s+([+-]\d+\.?\d*)/);
        const actionMatch = sharpText.match(/(FOLLOW THE SIGNAL|FADE THE PUBLIC|SHARP CONSENSUS)/i);
        if (isPass) {
          return (
            <div style={{
              background: 'rgba(100,116,139,0.15)',
              border: '1px solid rgba(100,116,139,0.3)',
              borderRadius: '8px',
              padding: '8px 10px',
              marginTop: '6px',
            }}>
              <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: 800, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
                NO EDGE — PASS
              </div>
              <div style={{ color: '#64748b', fontSize: '10px', fontWeight: 600, marginTop: '2px' }}>
                No actionable signal detected
              </div>
            </div>
          );
        }
        if (!betMatch) return null;
        const betTeam = betMatch[1].trim();
        const betSpread = betMatch[2];
        const action = actionMatch?.[1]?.toUpperCase() || 'SIGNAL';
        // Find opposing team
        const oppTeam = betTeam.toLowerCase().includes(game.homeTeam.split(' ').pop()!.toLowerCase())
          ? game.awayTeam : game.homeTeam;
        const oppSpread = betSpread.startsWith('+') ? betSpread.replace('+', '-') : betSpread.replace('-', '+');
        return (
          <div style={{
            background: 'rgba(139,92,246,0.12)',
            border: '1px solid rgba(139,92,246,0.3)',
            borderRadius: '8px',
            padding: '8px 10px',
            marginTop: '6px',
          }}>
            <div style={{ color: '#a78bfa', fontSize: '11px', fontWeight: 900, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
              BET: {betTeam} {betSpread} (fading {oppTeam} {oppSpread})
            </div>
            <div style={{ color: '#7c3aed', fontSize: '10px', fontWeight: 700, marginTop: '2px' }}>
              {action} • Line moving against consensus
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function LogCycleModal({ game, onClose, onLog }: {
  game: GameView;
  onClose: () => void;
  onLog: (params: { game_id: string; league: string; away_team: string; home_team: string; game_date: string; game_time: string; signal_tier?: string; sharp_side: string; sharp_spread: string; h1_units: number }) => Promise<unknown>;
}) {
  const [units, setUnits] = useState('1');
  const [spread, setSpread] = useState(game.currentSpread !== null ? String(game.currentSpread) : '');
  const [sharpSide, setSharpSide] = useState(game.sharpTeam || '');
  const [saving, setSaving] = useState(false);

  const handleLog = async () => {
    if (!sharpSide || !spread) return;
    setSaving(true);
    try {
      await onLog({
        game_id: game.id,
        league: game.league,
        away_team: game.awayTeam,
        home_team: game.homeTeam,
        game_date: new Date(game.gameTime).toISOString().split('T')[0],
        game_time: game.gameTime,
        signal_tier: game.signalTier ?? undefined,
        sharp_side: sharpSide,
        sharp_spread: spread,
        h1_units: parseFloat(units) || 1,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const inputStyle: React.CSSProperties = {
    background: '#020617',
    border: '1px solid rgba(255,255,255,0.1)',
    color: '#e2e8f0',
    borderRadius: '8px',
    padding: '8px 10px',
    fontWeight: 700,
    fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
    fontSize: '13px',
    width: '100%',
    boxSizing: 'border-box',
  };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: '#111827', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ color: '#f8fafc', fontWeight: 900, fontSize: '17px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif', marginBottom: '4px' }}>
          Log HM Cycle
        </div>
        <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 700, marginBottom: '20px' }}>
          {game.awayTeam} @ {game.homeTeam} • {game.league}
        </div>

        <div style={{ marginBottom: '14px' }}>
          <div style={{ color: '#94a3b8', fontSize: '10px', textTransform: 'uppercase' as const, fontWeight: 800, letterSpacing: '0.08em', marginBottom: '6px' }}>
            Sharp Side {game.sharpTeam ? '(auto-detected)' : '(manual — pick a team)'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            {[game.awayTeam, game.homeTeam].map((team) => (
              <button
                key={team}
                onClick={() => setSharpSide(team)}
                style={{
                  flex: 1,
                  background: sharpSide === team ? '#7c3aed' : '#020617',
                  border: `1px solid ${sharpSide === team ? '#7c3aed' : 'rgba(255,255,255,0.1)'}`,
                  color: sharpSide === team ? '#fff' : '#94a3b8',
                  borderRadius: '8px',
                  padding: '8px 6px',
                  cursor: 'pointer',
                  fontWeight: 900,
                  fontSize: '11px',
                  fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
                }}
              >
                {team}
              </button>
            ))}
          </div>
          {game.signalTier && game.signalTier !== 'TRACKING' && (
            <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 700, marginTop: '6px' }}>Signal: {game.signalTier}</div>
          )}
        </div>

        <div style={{ marginBottom: '14px' }}>
          <div style={{ color: '#94a3b8', fontSize: '10px', textTransform: 'uppercase' as const, fontWeight: 800, letterSpacing: '0.08em', marginBottom: '6px' }}>Spread</div>
          <input value={spread} onChange={(e) => setSpread(e.target.value)} placeholder="e.g. +4.5 or -7" style={inputStyle} />
        </div>

        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: '#94a3b8', fontSize: '10px', textTransform: 'uppercase' as const, fontWeight: 800, letterSpacing: '0.08em', marginBottom: '6px' }}>1H Units</div>
          <input value={units} onChange={(e) => setUnits(e.target.value)} placeholder="1" type="number" min="0.5" step="0.5" style={inputStyle} />
          <div style={{ color: '#475569', fontSize: '11px', marginTop: '4px', fontWeight: 600 }}>2H recovery = {((parseFloat(units) || 1) * 2).toFixed(1)} units (auto)</div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, background: 'transparent', border: '1px solid #334155', color: '#94a3b8', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontWeight: 800, fontSize: '13px' }}>
            Cancel
          </button>
          <button
            onClick={handleLog}
            disabled={!sharpSide || !spread || saving}
            style={{ flex: 2, background: '#7c3aed', border: 'none', color: '#fff', borderRadius: '8px', padding: '10px', cursor: 'pointer', fontWeight: 900, fontSize: '13px', fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}
          >
            {saving ? 'Logging...' : 'Log Cycle'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const { games, loading, lastUpdated, refresh } = useGamesFeed();
  const [ncaabLogos, setNcaabLogos] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchNcaabLogoMap().then(setNcaabLogos);
  }, []);

  const { logCycle } = useHMCycles();
  const hasLiveGames = games.some(g => g.status === 'live');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('live');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [hsaGame, setHsaGame] = useState<GameView | null>(null);
  const [logCycleGame, setLogCycleGame] = useState<GameView | null>(null);

  // Default to 'upcoming' when no live games
  useEffect(() => {
    if (!loading && !hasLiveGames && statusFilter === 'live') {
      setStatusFilter('upcoming');
    }
  }, [loading, hasLiveGames, statusFilter]);

  const filteredGames = useMemo(() => {
    let result = [...games];

    if (statusFilter !== 'all') {
      result = result.filter((g) => g.status === statusFilter);
    }

    if (alertsOnly) {
      result = result.filter((g) => isAlertSignal(g.signalTier));
    }

    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (g) =>
          g.homeTeam.toLowerCase().includes(q) ||
          g.awayTeam.toLowerCase().includes(q) ||
          g.league.toLowerCase().includes(q)
      );
    }

    result.sort((a, b) => {
      const signalDiff = getSignalRank(b.signalTier) - getSignalRank(a.signalTier);
      if (signalDiff !== 0) return signalDiff;
      return a.timeToTipMinutes - b.timeToTipMinutes;
    });

    return result;
  }, [games, statusFilter, alertsOnly, search]);

  const strongestSignal = useMemo(() => {
    const candidates = games.filter(
      (g) => (g.status === 'upcoming' || g.status === 'live') && isAlertSignal(g.signalTier)
    );
    const sorted = candidates.sort((a, b) => {
      const rankDiff = getSignalRank(b.signalTier) - getSignalRank(a.signalTier);
      if (rankDiff !== 0) return rankDiff;
      return a.timeToTipMinutes - b.timeToTipMinutes;
    });
    return sorted[0] ?? null;
  }, [games]);

  const liveCount = games.filter((g) => g.status === 'live').length;
  const upcomingCount = games.filter((g) => g.status === 'upcoming').length;
  const finalCount = games.filter((g) => g.status === 'final').length;
  const alertCount = games.filter((g) => isAlertSignal(g.signalTier)).length;

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#020617',
        color: '#e2e8f0',
        padding: '20px',
        fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: '16px',
            marginBottom: '18px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h1
              style={{
                margin: 0,
                color: '#f8fafc',
                fontSize: '30px',
                fontWeight: 900,
                fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
              }}
            >
              RLM Tracker v3
            </h1>
            <div style={{ color: '#94a3b8', marginTop: '6px', fontSize: '14px', fontWeight: 800 }}>
              Live market movement intelligence
            </div>
            <div style={{ color: '#64748b', marginTop: '6px', fontSize: '12px', fontWeight: 800 }}>
              Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
            </div>
          </div>

          <button
            onClick={refresh}
            style={{
              background: '#1d4ed8',
              color: '#fff',
              border: 'none',
              borderRadius: '10px',
              padding: '10px 14px',
              fontWeight: 900,
              cursor: 'pointer',
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            Refresh Board
          </button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: '12px',
            marginBottom: '18px',
          }}
        >
          <div style={{ background: '#111827', borderRadius: '14px', padding: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={cardLabelStyle()}>Live Games</div>
            <div style={summaryValueStyle()}>{liveCount}</div>
          </div>

          <div style={{ background: '#111827', borderRadius: '14px', padding: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={cardLabelStyle()}>Upcoming</div>
            <div style={summaryValueStyle()}>{upcomingCount}</div>
          </div>

          <div style={{ background: '#111827', borderRadius: '14px', padding: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={cardLabelStyle()}>Final</div>
            <div style={summaryValueStyle()}>{finalCount}</div>
          </div>

          <div style={{ background: '#111827', borderRadius: '14px', padding: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={cardLabelStyle()}>Active Alerts</div>
            <div style={summaryValueStyle()}>{alertCount}</div>
          </div>
        </div>

        <div
          style={{
            background: '#111827',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
            padding: '16px',
            marginBottom: '18px',
          }}
        >
          <div style={cardLabelStyle()}>Strongest Signal Right Now</div>
          {strongestSignal ? (
            <div style={{ marginTop: '8px' }}>
              <div
                style={{
                  color: '#f8fafc',
                  fontSize: '18px',
                  fontWeight: 900,
                  fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
                }}
              >
                {strongestSignal.awayTeam} @ {strongestSignal.homeTeam}
              </div>
              <div style={{ color: signalColor(strongestSignal.signalTier), fontWeight: 900, marginTop: '6px' }}>
                {strongestSignal.signalTier}
              </div>
              <div style={{ color: '#cbd5e1', marginTop: '6px', fontSize: '14px', fontWeight: 800 }}>
                Sharp Team: {strongestSignal.sharpTeam ?? '—'} • Line Move:{' '}
                {strongestSignal.lineMoveAmount ?? '—'}
              </div>
            </div>
          ) : (
            <div style={{ color: '#94a3b8', marginTop: '8px', fontWeight: 800 }}>No active signals right now</div>
          )}
        </div>

        <div
          style={{
            background: '#111827',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '14px',
            padding: '16px',
            marginBottom: '18px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '12px',
            alignItems: 'center',
          }}
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team or league"
            style={{
              background: '#020617',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#e2e8f0',
              borderRadius: '10px',
              padding: '10px 12px',
              minWidth: '220px',
              fontWeight: 800,
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          />

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{
              background: '#020617',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#e2e8f0',
              borderRadius: '10px',
              padding: '10px 12px',
              fontWeight: 800,
              fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
            }}
          >
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="final">Final</option>
            <option value="all">All Games</option>
          </select>

          <label style={{ display: 'flex', gap: '8px', alignItems: 'center', color: '#cbd5e1', fontWeight: 800 }}>
            <input
              type="checkbox"
              checked={alertsOnly}
              onChange={(e) => setAlertsOnly(e.target.checked)}
            />
            Alerts only
          </label>
        </div>

        {loading ? (
          <div style={{ color: '#94a3b8', fontWeight: 800 }}>Loading board...</div>
        ) : filteredGames.length === 0 ? (
          <div style={{ color: '#94a3b8', fontWeight: 800 }}>No games match the current filters.</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
              gap: '14px',
            }}
          >
            {filteredGames.map((game) => (
              <GameCard key={game.id} game={game} ncaabLogos={ncaabLogos} onOpenHsa={setHsaGame} onLogCycle={setLogCycleGame} />
            ))}
          </div>
        )}
      </div>

      {hsaGame && <HsaModal game={hsaGame} onClose={() => setHsaGame(null)} onRefresh={refresh} />}
      {logCycleGame && (
        <LogCycleModal
          game={logCycleGame}
          onClose={() => setLogCycleGame(null)}
          onLog={logCycle}
        />
      )}
    </div>
  );
}