import { useMemo, useState } from 'react';
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

function getCollegeLogoUrl(teamName: string) {
  const ncaabIds: Record<string, number> = {
    alabama: 333, alabamacrimsontide: 333,
    arizona: 12, arizonawildcats: 12,
    arizonastate: 9, arizonastatesundevils: 9,
    arkansas: 8, arkansasrazorbacks: 8,
    auburn: 2, auburntigers: 2,
    baylor: 239, baylorbears: 239,
    brighamyoung: 252, byu: 252, byucougars: 252,
    cincinnati: 2132, cincinnatibearcats: 2132,
    clemson: 228, clemsontigers: 228,
    colorado: 38, coloradobuffaloes: 38,
    connecticut: 41, uconn: 41, uconnhuskies: 41, connecticuthuskies: 41,
    creighton: 156, creightonbluejays: 156,
    duke: 150, dukebluedevils: 150,
    florida: 57, floridagators: 57,
    floridastate: 52, floridastatesseminoles: 52,
    georgetown: 46, georgetownhoyas: 46,
    gonzaga: 2250, gonzagabulldogs: 2250,
    illinois: 356, illinoisfightingillini: 356,
    indiana: 84, indianahoosiers: 84,
    iowa: 2294, iowahawkeyes: 2294,
    iowastate: 66, iowastatecyclones: 66,
    kansas: 2305, kansasjayhawks: 2305,
    kansasstate: 2306, kansasstatewildcats: 2306,
    kentucky: 96, kentuckywildcats: 96,
    louisville: 97, louisvillecardinals: 97,
    louisianastate: 99, lsu: 99, lsutigers: 99,
    marquette: 269, marquettegoldenengles: 269,
    maryland: 120, marylandterrapins: 120,
    memphis: 235, memphistigers: 235,
    michigan: 130, michiganwolverines: 130,
    michiganstate: 127, michiganstatespartans: 127,
    minnesota: 135, minnesotgoldengophers: 135,
    mississippi: 145, olemiss: 145, mississippirebels: 145,
    mississippistate: 344, mississippistatebulldogs: 344,
    missouri: 142, missouritigers: 142,
    nebraska: 158, nebraskacornhuskers: 158,
    northcarolina: 153, unc: 153, northcarolinatarheels: 153,
    ncstate: 152, northcarolinastate: 152, northcarolinastatewolfpack: 152,
    notredame: 87, notredamefightingirish: 87,
    ohiostate: 194, ohiostatebuckeyes: 194,
    oklahoma: 201, oklahomasooners: 201,
    oklahomastate: 197, oklahomastatecowboys: 197,
    oregon: 2483, oregonducks: 2483,
    oregonstate: 204, oregonstatebeavers: 204,
    pennstate: 213, pennstatenittanylions: 213,
    pittsburgh: 221, pitt: 221, pittsburghpanthers: 221,
    purdue: 2509, purdueboilermakers: 2509,
    rutgers: 164, rutgersscarletkights: 164,
    saintlouis: 139, saintlouisbillikens: 139,
    saintmarys: 2608, saintmarysgaels: 2608, stmarys: 2608, stmarysgaels: 2608,
    santaclara: 2541, santaclarabroncos: 2541,
    sandiegostate: 21, sandiegostateaztecs: 21,
    setonhall: 2550, setonhallpirates: 2550,
    southernmethodist: 2567, smu: 2567, smumustangs: 2567,
    stanford: 24, stanfordcardinal: 24,
    syracuse: 183, syracuseorange: 183,
    texaschristian: 2628, tcu: 2628, tcuhornedfrogs: 2628,
    tennessee: 2633, tennesseevolunteers: 2633,
    texas: 251, texaslonghorns: 251,
    texasampm: 245, texasam: 245, texasamaggies: 245,
    texastech: 2641, texastechredraiders: 2641,
    ucla: 26, uclabruins: 26,
    southerncalifornia: 30, usc: 30, usctrojans: 30,
    utah: 254, utahutes: 254,
    vanderbilt: 238, vanderbiltcommodores: 238,
    villanova: 222, villanowawildcats: 222,
    virginia: 258, virginiacavaliers: 258,
    virginiacommonwealth: 2670, vcu: 2670, vcurams: 2670,
    virginiatech: 259, virginiatechhokies: 259,
    wakeforest: 154, wakeforestdemondeacons: 154,
    washington: 264, washingtonhuskies: 264,
    westvirginia: 277, westvirginiamountaineers: 277,
    wisconsin: 275, wisconsinbadgers: 275,
    xavier: 2752, xaviermusketeers: 2752,
    furman: 231, furmanpaladins: 231,
    troy: 2653, troytrojans: 2653,
    georgiasouthern: 290, georgiasoutherneagles: 290,
    easttenesseestate: 2193, etsu: 2193,
  };

  const id = ncaabIds[normalizeKey(teamName)];
  return id ? `https://a.espncdn.com/i/teamlogos/ncaa/500/${id}.png` : null;
}

function getTeamLogo(league: string, teamName: string) {
  if (league === 'NBA') return getNbaLogoUrl(teamName);
  if (league === 'NCAAB') return getCollegeLogoUrl(teamName);
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

function TeamBadge({ league, teamName }: { league: string; teamName: string }) {
  const logo = getTeamLogo(league, teamName);

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

function GameCard({ game }: { game: GameView }) {
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
          <TeamBadge league={game.league} teamName={game.awayTeam} />
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: '#f8fafc',
                fontWeight: 900,
                fontSize: '14px',
                fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
              }}
            >
              {game.awayTeam}
            </div>
          </div>
        </div>

        <div
          style={{
            color: '#64748b',
            fontWeight: 900,
            fontSize: '13px',
            fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
          }}
        >
          @
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '10px', minWidth: 0 }}>
          <div style={{ minWidth: 0, textAlign: 'right' }}>
            <div
              style={{
                color: '#f8fafc',
                fontWeight: 900,
                fontSize: '14px',
                fontFamily: '"Arial Black", "Segoe UI", Arial, sans-serif',
              }}
            >
              {game.homeTeam}
            </div>
          </div>
          <TeamBadge league={game.league} teamName={game.homeTeam} />
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

      <div>
        <div style={cardLabelStyle()}>Intel</div>
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

  const [statusFilter, setStatusFilter] = useState<StatusFilter>('upcoming');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState('');

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
    const sorted = [...games].sort((a, b) => getSignalRank(b.signalTier) - getSignalRank(a.signalTier));
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
              RLM Tracker
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
            <div style={{ color: '#94a3b8', marginTop: '8px', fontWeight: 800 }}>No games loaded yet</div>
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
            <option value="all">All Games</option>
            <option value="upcoming">Upcoming</option>
            <option value="live">Live</option>
            <option value="final">Final</option>
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
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}