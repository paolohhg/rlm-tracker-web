import { useMemo, useState, useEffect } from 'react';
import { useGamesFeed } from '../hooks/useGamesFeed';
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

function HsaModal({ game, onClose }: { game: GameView; onClose: () => void }) {
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

        {game.hsaNarrative ? (
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
            {game.hsaNarrative}
          </div>
        ) : (
          <div style={{ color: '#64748b', fontSize: '14px', fontWeight: 700, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
            No analysis available for this game yet.
          </div>
        )}

        <div style={{ color: '#475569', fontSize: '11px', marginTop: '16px', fontWeight: 700, fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif' }}>
          For informational and research purposes only.
        </div>
      </div>
    </div>
  );
}

function GameCard({ game, ncaabLogos, onOpenHsa }: { game: GameView; ncaabLogos: Record<string, string>; onOpenHsa: (game: GameView) => void }) {
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

      {/* Betting splits */}
      {(game.publicBetsPct !== null || game.publicMoneyPct !== null || game.booksAgreeing !== null) && (
        <div style={{ background: '#020617', borderRadius: '10px', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={cardLabelStyle()}>Betting Splits</div>
          {game.publicBetsPct !== null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', fontWeight: 700, marginBottom: '3px' }}>
                <span>Public Bets</span>
                <span>{game.publicBetsPct}% public</span>
              </div>
              <div style={{ background: '#1e293b', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{ width: `${game.publicBetsPct}%`, height: '100%', background: '#3b82f6', borderRadius: '4px' }} />
              </div>
            </div>
          )}
          {game.publicMoneyPct !== null && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', fontWeight: 700, marginBottom: '3px' }}>
                <span>Public Money</span>
                <span>{game.publicMoneyPct}% public</span>
              </div>
              <div style={{ background: '#1e293b', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{ width: `${game.publicMoneyPct}%`, height: '100%', background: '#8b5cf6', borderRadius: '4px' }} />
              </div>
            </div>
          )}
          {game.booksAgreeing !== null && game.totalBooks !== null && (
            <div style={{ fontSize: '11px', color: '#64748b', fontWeight: 700 }}>
              {game.booksAgreeing}/{game.totalBooks} books agreeing • {game.velocityPerHour !== null ? `${game.velocityPerHour}/hr velocity` : ''}
            </div>
          )}
        </div>
      )}

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
    </div>
  );
}

export function Dashboard() {
  const { games, loading, lastUpdated, refresh } = useGamesFeed();
  const [ncaabLogos, setNcaabLogos] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchNcaabLogoMap().then(setNcaabLogos);
  }, []);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('live');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [hsaGame, setHsaGame] = useState<GameView | null>(null);

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
              <GameCard key={game.id} game={game} ncaabLogos={ncaabLogos} onOpenHsa={setHsaGame} />
            ))}
          </div>
        )}
      </div>

      {hsaGame && <HsaModal game={hsaGame} onClose={() => setHsaGame(null)} />}
    </div>
  );
}