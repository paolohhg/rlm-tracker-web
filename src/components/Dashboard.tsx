import React, { useMemo, useState, useEffect, useCallback } from 'react';
import { useGamesFeed } from '../hooks/useGamesFeed';
import { useGenerateHsa } from '../hooks/useGenerateHsa';
// useHMCycles import removed — HM Cycles hidden for now
import { ShareStudio } from './ShareStudio';
import { ProReport } from './ProReport';
import { T, BADGE_COLORS, STATUS_TAG_COLORS, CONFIDENCE_COLORS } from '../lib/theme';
import type { GameView } from '../types';

type StatusFilter = 'all' | 'upcoming' | 'live' | 'final';
type LeagueFilter = 'all' | 'NBA' | 'NCAAB' | 'MLB' | 'NHL';
type TournamentFilter = 'all' | 'ncaa_tournament' | 'nit';
type SignalFilter = 'all' | 'rlm' | 'steam' | 'sharp_accum' | 'freeze' | 'resistance' | 'fake_steam';
type TimeFilter = 'all' | 'lt1h' | '1to3h' | 'gt3h';

function isFrozenSignal(signalTier: string | null | undefined) {
  return signalTier === 'FROZEN LINE';
}

function matchesSignalFilter(game: GameView, filter: SignalFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'rlm': return isRlmSignal(game.signalTier);
    case 'steam': return isSteamSignal(game.signalTier);
    case 'sharp_accum': return game.signalTier === 'SHARP ACCUMULATION';
    case 'freeze': return isFrozenSignal(game.signalTier);
    case 'resistance': return game.isResistance;
    case 'fake_steam': return game.isFakeSteam;
  }
}

function matchesTimeFilter(game: GameView, filter: TimeFilter): boolean {
  if (filter === 'all') return true;
  if (game.status !== 'upcoming') return false;
  const m = game.timeToTipMinutes;
  switch (filter) {
    case 'lt1h': return m < 60;
    case '1to3h': return m >= 60 && m < 180;
    case 'gt3h': return m >= 180;
    default: return true;
  }
}

// ── Helpers ──────────────────────────────────────────────────
function isAlertSignal(signalTier: string | null | undefined) {
  return !!signalTier && signalTier !== 'WATCH' && signalTier !== 'TRACKING';
}

function isRlmSignal(signalTier: string | null | undefined) {
  return signalTier === 'DOUBLE NO-NARRATIVE RLM' || signalTier === 'NO-NARRATIVE RLM';
}

function isSteamSignal(signalTier: string | null | undefined) {
  return signalTier === 'STEAM MOVE';
}

function getSignalRank(signalTier: string | null | undefined) {
  switch (signalTier) {
    case 'DOUBLE NO-NARRATIVE RLM': return 5;
    case 'NO-NARRATIVE RLM': return 4;
    case 'STEAM MOVE': return 3;
    case 'FROZEN LINE': return 2;
    case 'SHARP ACCUMULATION': return 2.5;
    case 'BOOK SHADE': case 'CONTRA MOVE': return 1;
    case 'WATCH': return 0;
    default: return -1;
  }
}

function formatTimeToTip(minutes: number) {
  if (minutes <= 0) return 'Started';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function formatGameTime(gameTime: string) {
  try {
    return new Date(gameTime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return gameTime; }
}

function statusLabel(game: GameView) {
  if (game.status === 'live') {
    const pPrefix = game.league === 'NHL' ? 'P' : game.league === 'MLB' ? 'Inn' : 'Q';
    if (game.period && game.gameClock) return `${pPrefix}${game.period} ${game.gameClock}`;
    if (game.period) return `${pPrefix}${game.period}`;
    return 'LIVE';
  }
  if (game.status === 'final') return 'FINAL';
  return formatTimeToTip(game.timeToTipMinutes);
}

function statusColor(status: string) {
  if (status === 'live') return '#22c55e';
  if (status === 'final') return T.muted;
  return T.accent;
}

function normalizeKey(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// ── Logos ─────────────────────────────────────────────────────
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

function getNhlLogoUrl(teamName: string) {
  const logos: Record<string, string> = {
    anaheimducks: 'https://a.espncdn.com/i/teamlogos/nhl/500/ana.png',
    arizonacoyotes: 'https://a.espncdn.com/i/teamlogos/nhl/500/ari.png',
    bostonbruins: 'https://a.espncdn.com/i/teamlogos/nhl/500/bos.png',
    buffalosabres: 'https://a.espncdn.com/i/teamlogos/nhl/500/buf.png',
    calgaryflames: 'https://a.espncdn.com/i/teamlogos/nhl/500/cgy.png',
    carolinahurricanes: 'https://a.espncdn.com/i/teamlogos/nhl/500/car.png',
    chicagoblackhawks: 'https://a.espncdn.com/i/teamlogos/nhl/500/chi.png',
    coloradoavalanche: 'https://a.espncdn.com/i/teamlogos/nhl/500/col.png',
    columbusbluejackets: 'https://a.espncdn.com/i/teamlogos/nhl/500/cbj.png',
    dallasstars: 'https://a.espncdn.com/i/teamlogos/nhl/500/dal.png',
    detroitredwings: 'https://a.espncdn.com/i/teamlogos/nhl/500/det.png',
    edmontonoilers: 'https://a.espncdn.com/i/teamlogos/nhl/500/edm.png',
    floridapanthers: 'https://a.espncdn.com/i/teamlogos/nhl/500/fla.png',
    losangeleskings: 'https://a.espncdn.com/i/teamlogos/nhl/500/la.png',
    minnesotawild: 'https://a.espncdn.com/i/teamlogos/nhl/500/min.png',
    montrealcanadiens: 'https://a.espncdn.com/i/teamlogos/nhl/500/mtl.png',
    nashvillepredators: 'https://a.espncdn.com/i/teamlogos/nhl/500/nsh.png',
    newjerseydevils: 'https://a.espncdn.com/i/teamlogos/nhl/500/njd.png',
    newyorkislanders: 'https://a.espncdn.com/i/teamlogos/nhl/500/nyi.png',
    newyorkrangers: 'https://a.espncdn.com/i/teamlogos/nhl/500/nyr.png',
    ottawasenators: 'https://a.espncdn.com/i/teamlogos/nhl/500/ott.png',
    philadelphiaflyers: 'https://a.espncdn.com/i/teamlogos/nhl/500/phi.png',
    pittsburghpenguins: 'https://a.espncdn.com/i/teamlogos/nhl/500/pit.png',
    sanjosesharks: 'https://a.espncdn.com/i/teamlogos/nhl/500/sj.png',
    seattlekraken: 'https://a.espncdn.com/i/teamlogos/nhl/500/sea.png',
    stlouisblues: 'https://a.espncdn.com/i/teamlogos/nhl/500/stl.png',
    tampabaylightning: 'https://a.espncdn.com/i/teamlogos/nhl/500/tb.png',
    torontomapleleafs: 'https://a.espncdn.com/i/teamlogos/nhl/500/tor.png',
    utahhockeyclub: 'https://a.espncdn.com/i/teamlogos/nhl/500/utah.png',
    vancouvercanucks: 'https://a.espncdn.com/i/teamlogos/nhl/500/van.png',
    vegasgoldenknights: 'https://a.espncdn.com/i/teamlogos/nhl/500/vgk.png',
    washingtoncapitals: 'https://a.espncdn.com/i/teamlogos/nhl/500/wsh.png',
    winnipegjets: 'https://a.espncdn.com/i/teamlogos/nhl/500/wpg.png',
  };
  return logos[normalizeKey(teamName)] ?? null;
}

function getMlbLogoUrl(teamName: string) {
  const logos: Record<string, string> = {
    arizonadiamondbacks: 'https://a.espncdn.com/i/teamlogos/mlb/500/ari.png',
    atlantabraves: 'https://a.espncdn.com/i/teamlogos/mlb/500/atl.png',
    baltimoreorioles: 'https://a.espncdn.com/i/teamlogos/mlb/500/bal.png',
    bostonredsox: 'https://a.espncdn.com/i/teamlogos/mlb/500/bos.png',
    chicagocubs: 'https://a.espncdn.com/i/teamlogos/mlb/500/chc.png',
    chicagowhitesox: 'https://a.espncdn.com/i/teamlogos/mlb/500/chw.png',
    cincinnatireds: 'https://a.espncdn.com/i/teamlogos/mlb/500/cin.png',
    clevelandguardians: 'https://a.espncdn.com/i/teamlogos/mlb/500/cle.png',
    coloradorockies: 'https://a.espncdn.com/i/teamlogos/mlb/500/col.png',
    detroittigers: 'https://a.espncdn.com/i/teamlogos/mlb/500/det.png',
    houstonastros: 'https://a.espncdn.com/i/teamlogos/mlb/500/hou.png',
    kansascityroyals: 'https://a.espncdn.com/i/teamlogos/mlb/500/kc.png',
    losangelesangels: 'https://a.espncdn.com/i/teamlogos/mlb/500/laa.png',
    losangelesdodgers: 'https://a.espncdn.com/i/teamlogos/mlb/500/lad.png',
    miamimarlins: 'https://a.espncdn.com/i/teamlogos/mlb/500/mia.png',
    milwaukeebrewers: 'https://a.espncdn.com/i/teamlogos/mlb/500/mil.png',
    minnesotatwins: 'https://a.espncdn.com/i/teamlogos/mlb/500/min.png',
    newyorkmets: 'https://a.espncdn.com/i/teamlogos/mlb/500/nym.png',
    newyorkyankees: 'https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png',
    oaklandathletics: 'https://a.espncdn.com/i/teamlogos/mlb/500/oak.png',
    philadelphiaphillies: 'https://a.espncdn.com/i/teamlogos/mlb/500/phi.png',
    pittsburghpirates: 'https://a.espncdn.com/i/teamlogos/mlb/500/pit.png',
    sandiegopadres: 'https://a.espncdn.com/i/teamlogos/mlb/500/sd.png',
    sanfranciscogiants: 'https://a.espncdn.com/i/teamlogos/mlb/500/sf.png',
    seattlemariners: 'https://a.espncdn.com/i/teamlogos/mlb/500/sea.png',
    stlouiscardinals: 'https://a.espncdn.com/i/teamlogos/mlb/500/stl.png',
    tampabayrays: 'https://a.espncdn.com/i/teamlogos/mlb/500/tb.png',
    texasrangers: 'https://a.espncdn.com/i/teamlogos/mlb/500/tex.png',
    torontobluejays: 'https://a.espncdn.com/i/teamlogos/mlb/500/tor.png',
    washingtonnationals: 'https://a.espncdn.com/i/teamlogos/mlb/500/wsh.png',
  };
  return logos[normalizeKey(teamName)] ?? null;
}

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
        return map;
      })
      .catch(() => ({}));
  }
  return ncaabLogoCachePromise;
}

function getTeamLogo(league: string, teamName: string, ncaabLogos: Record<string, string>) {
  const l = league.toUpperCase();
  if (l === 'NBA') return getNbaLogoUrl(teamName);
  if (l === 'NCAAB') return ncaabLogos[normalizeKey(teamName)] ?? null;
  if (l === 'NHL') return getNhlLogoUrl(teamName);
  if (l === 'MLB') return getMlbLogoUrl(teamName);
  return null;
}

function getTeamInitials(teamName: string) {
  return teamName.split(' ').map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

// ── Badge Component ──────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        background: `${color}18`,
        color,
        fontSize: '10px',
        fontWeight: 700,
        padding: '3px 8px',
        borderRadius: '4px',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        boxShadow: `0 0 8px ${color}30`,
        fontFamily: T.font,
      }}
    >
      {label}
    </span>
  );
}

function SignalBadges({ game }: { game: GameView }) {
  const badges: { label: string; color: string }[] = [];

  // Signal badges
  if (isRlmSignal(game.signalTier)) {
    badges.push({ label: game.signalTier === 'DOUBLE NO-NARRATIVE RLM' ? 'DOUBLE RLM' : 'RLM', color: BADGE_COLORS.RLM });
  }
  if (isSteamSignal(game.signalTier)) {
    badges.push({ label: 'STEAM', color: BADGE_COLORS.STEAM });
  }
  if (game.signalTier === 'FROZEN LINE') {
    badges.push({ label: 'FREEZE', color: BADGE_COLORS.FREEZE });
  }
  if (game.signalTier === 'SHARP ACCUMULATION') {
    badges.push({ label: 'SHARP ACC.', color: '#f59e0b' });
  }
  if (game.signalTier === 'BOOK SHADE' || game.signalTier === 'CONTRA MOVE') {
    badges.push({ label: 'ALERT', color: BADGE_COLORS.ALERT });
  }

  if (badges.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {badges.map((b) => <Badge key={b.label} label={b.label} color={b.color} />)}
    </div>
  );
}

function IntelBadges({ game }: { game: GameView }) {
  const badges: { label: string; color: string }[] = [];

  if (game.isResistance) {
    badges.push({ label: 'RESISTANCE', color: BADGE_COLORS.RESISTANCE });
  }
  if (game.isFakeSteam) {
    badges.push({ label: 'FAKE STEAM', color: BADGE_COLORS['FAKE STEAM'] });
  }

  if (badges.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
      {badges.map((b) => <Badge key={b.label} label={b.label} color={b.color} />)}
    </div>
  );
}

// ── Team Badge ───────────────────────────────────────────────
function TeamBadge({ league, teamName, ncaabLogos, size = 28 }: { league: string; teamName: string; ncaabLogos: Record<string, string>; size?: number }) {
  const logo = getTeamLogo(league, teamName, ncaabLogos);

  if (logo) {
    return (
      <img
        src={logo}
        alt={teamName}
        style={{ width: size, height: size, objectFit: 'contain', borderRadius: '999px', background: '#fff', padding: '2px' }}
      />
    );
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '999px',
        background: T.hover,
        color: T.text,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.max(9, size * 0.32),
        fontWeight: 700,
        fontFamily: T.font,
      }}
    >
      {getTeamInitials(teamName)}
    </div>
  );
}

// ── HSA Text Parsing Helpers ─────────────────────────────────
function extractHsaField(text: string, field: string): string {
  const re = new RegExp(`${field}:\\s*(.+)`, 'i');
  const m = text.match(re);
  return m?.[1]?.trim() || '';
}

// ── HSA Modal ────────────────────────────────────────────────
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
    if (result?.narrative) setLocalNarrative(result.narrative);
  }, [generate, game, localNarrative]);

  const narrative = localNarrative;

  // Extract structured fields from narrative text for visual badges
  const statusTag = narrative?.match(/\b(PASS|WATCH|ACTIVE)\b/)?.[1] || '';
  const marketLean = narrative ? extractHsaField(narrative, 'Market Lean') : '';
  const confidence = narrative ? extractHsaField(narrative, 'Confidence') : '';

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: '12px', padding: '24px', maxWidth: '640px', width: '100%', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.6)' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <img src="/hsi-logo.jpg" alt="" style={{ height: '20px', width: '20px', borderRadius: '4px' }} />
              <span style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', fontFamily: T.font }}>Heard Sports Analysis</span>
            </div>
            <div style={{ color: T.text, fontWeight: 700, fontSize: '16px', marginTop: '6px', fontFamily: T.font }}>{game.awayTeam} @ {game.homeTeam}</div>
            <div style={{ color: T.muted, fontSize: '12px', marginTop: '4px', fontFamily: T.font }}>{game.league} {game.signalTier && game.signalTier !== 'TRACKING' && game.signalTier !== 'WATCH' ? `\u2022 ${game.signalTier}` : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: T.hover, border: 'none', color: T.textSecondary, borderRadius: '999px', width: '28px', height: '28px', cursor: 'pointer', fontWeight: 700, fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>✕</button>
        </div>

        {narrative ? (
          <div>
            {/* Status + Market Lean + Confidence badges */}
            {statusTag && (
              <div style={{ display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' }}>
                <div style={{
                  background: (STATUS_TAG_COLORS[statusTag] || STATUS_TAG_COLORS.WATCH).bg,
                  color: (STATUS_TAG_COLORS[statusTag] || STATUS_TAG_COLORS.WATCH).text,
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontWeight: 800,
                  fontFamily: T.font,
                  letterSpacing: '0.06em',
                }}>
                  {statusTag}
                </div>
                {marketLean && marketLean !== 'PASS' && (
                  <div style={{
                    background: T.hover,
                    color: T.text,
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '12px',
                    fontWeight: 700,
                    fontFamily: T.font,
                  }}>
                    {marketLean}
                  </div>
                )}
                {confidence && (
                  <div style={{
                    background: 'transparent',
                    border: `1px solid ${T.border}`,
                    color: CONFIDENCE_COLORS[confidence] || T.muted,
                    padding: '6px 14px',
                    borderRadius: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    fontFamily: T.font,
                    letterSpacing: '0.04em',
                  }}>
                    {confidence} confidence
                  </div>
                )}
              </div>
            )}

            {/* Full narrative */}
            <div style={{ color: T.text, fontSize: '13px', lineHeight: 1.7, fontWeight: 500, fontFamily: T.font, whiteSpace: 'pre-wrap' }}>{narrative}</div>
            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>{error}</div>}
            <button onClick={() => handleGenerate(true)} disabled={loading} style={{ marginTop: '12px', background: 'transparent', border: `1px solid ${T.border}`, color: T.textSecondary, borderRadius: '6px', padding: '6px 14px', cursor: loading ? 'wait' : 'pointer', fontSize: '12px', fontWeight: 600, fontFamily: T.font }}>
              {loading ? 'Refreshing...' : 'Refresh Analysis'}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ color: T.muted, fontSize: '13px', fontFamily: T.font, marginBottom: '16px' }}>No analysis available for this game yet.</div>
            <button onClick={() => handleGenerate()} disabled={loading} style={{ background: T.accent, border: 'none', color: '#000', borderRadius: '8px', padding: '10px 22px', cursor: loading ? 'wait' : 'pointer', fontWeight: 700, fontSize: '13px', fontFamily: T.font }}>
              {loading ? 'Generating HSA...' : 'Generate HSA'}
            </button>
            {error && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '8px' }}>{error}</div>}
          </div>
        )}

        {/* Intel detail if present */}
        {(game.isResistance || game.isFakeSteam) && (
          <div style={{ marginTop: '16px', borderTop: `1px solid ${T.border}`, paddingTop: '12px' }}>
            <div style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px', fontFamily: T.font }}>Intelligence Detail</div>
            {game.isResistance && game.resistanceReason && (
              <div style={{ marginBottom: '6px' }}>
                <Badge label="RESISTANCE" color={BADGE_COLORS.RESISTANCE} />
                <span style={{ color: T.textSecondary, fontSize: '12px', marginLeft: '8px', fontFamily: T.font }}>{game.resistanceReason} (score: {game.resistanceScore})</span>
              </div>
            )}
            {game.isFakeSteam && game.fakeSteamReason && (
              <div>
                <Badge label="FAKE STEAM" color={BADGE_COLORS['FAKE STEAM']} />
                <span style={{ color: T.textSecondary, fontSize: '12px', marginLeft: '8px', fontFamily: T.font }}>{game.fakeSteamReason} (score: {game.fakeSteamScore})</span>
                {game.marketRange != null && <span style={{ color: T.muted, fontSize: '11px', marginLeft: '6px' }}>range: {game.marketRange.toFixed(1)}</span>}
              </div>
            )}
          </div>
        )}

        <div style={{ color: T.muted, fontSize: '10px', marginTop: '16px', fontFamily: T.font }}>
          For research purposes only.
        </div>
      </div>
    </div>
  );
}

// ── Log Cycle Modal — HIDDEN (HM Cycles feature shelved) ────

// ── Summary Card ─────────────────────────────────────────────
function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ background: T.panel, borderRadius: '10px', padding: '14px 16px', border: `1px solid ${T.border}`, minWidth: 0 }}>
      <div style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font }}>{label}</div>
      <div style={{ color: color ?? T.text, fontSize: '24px', fontWeight: 800, fontFamily: T.font, marginTop: '4px' }}>{value}</div>
    </div>
  );
}

// ── Desktop Table Row ────────────────────────────────────────
function GameTableRow({ game, ncaabLogos, onOpenHsa, onShare, onProReport }: { game: GameView; ncaabLogos: Record<string, string>; onOpenHsa: (game: GameView) => void; onShare: (game: GameView) => void; onProReport: (game: GameView) => void }) {
  const [hovered, setHovered] = useState(false);

  const spreadDisplay = () => {
    if (game.openingSpread == null && game.currentSpread == null) return '—';
    const open = game.openingSpread != null ? String(game.openingSpread) : '—';
    const curr = game.currentSpread != null ? String(game.currentSpread) : '—';
    if (open === curr) return curr;
    return `${open} \u2192 ${curr}`;
  };

  const moveDisplay = () => {
    if (game.lineMoveAmount == null) return '—';
    const sign = game.lineMoveAmount > 0 ? '+' : '';
    return `${sign}${game.lineMoveAmount}`;
  };

  const consensusDisplay = () => {
    if (game.publicBetsPct == null) return '—';
    const awayPct = game.awayBetsPct ?? (100 - game.publicBetsPct);
    return `${awayPct}/${game.publicBetsPct}`;
  };

  return (
    <tr
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onOpenHsa(game)}
      style={{
        background: hovered ? T.hover : 'transparent',
        cursor: 'pointer',
        transition: 'background 200ms',
        borderBottom: `1px solid ${T.border}`,
      }}
    >
      {/* GAME + TIME/STATUS */}
      <td style={{ padding: '12px 12px', verticalAlign: 'middle' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center', minWidth: '28px' }}>
            <TeamBadge league={game.league} teamName={game.awayTeam} ncaabLogos={ncaabLogos} size={22} />
            <TeamBadge league={game.league} teamName={game.homeTeam} ncaabLogos={ncaabLogos} size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: T.text, fontWeight: 600, fontSize: '13px', fontFamily: T.font }}>{game.awayTeam}</span>
              {game.status !== 'upcoming' && game.awayScore != null && (
                <span style={{ color: game.status === 'live' ? '#22c55e' : T.text, fontWeight: 800, fontSize: '14px', fontFamily: T.font }}>{game.awayScore}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: T.text, fontWeight: 600, fontSize: '13px', fontFamily: T.font }}>{game.homeTeam}</span>
              {game.status !== 'upcoming' && game.homeScore != null && (
                <span style={{ color: game.status === 'live' ? '#22c55e' : T.text, fontWeight: 800, fontSize: '14px', fontFamily: T.font }}>{game.homeScore}</span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
              <span style={{ color: T.muted, fontSize: '10px', fontWeight: 500, fontFamily: T.font }}>{game.league}</span>
              <span style={{ color: statusColor(game.status), fontWeight: 700, fontSize: '10px', fontFamily: T.font }}>
                {statusLabel(game)}
              </span>
              {game.status === 'upcoming' && (
                <span style={{ color: T.muted, fontSize: '10px', fontFamily: T.font }}>
                  {formatGameTime(game.gameTime)}
                </span>
              )}
            </div>
          </div>
        </div>
      </td>

      {/* SPREAD / LIVE SPREAD */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
        <div style={{ color: T.text, fontWeight: 700, fontSize: '13px', fontFamily: T.font }}>{spreadDisplay()}</div>
      </td>

      {/* TOTAL */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
        {game.openingTotal != null || game.currentTotal != null ? (
          <div>
            <div style={{ color: T.text, fontWeight: 700, fontSize: '13px', fontFamily: T.font }}>
              {game.openingTotal != null && game.currentTotal != null && game.openingTotal !== game.currentTotal
                ? `${game.openingTotal} \u2192 ${game.currentTotal}`
                : game.currentTotal ?? game.openingTotal ?? '—'}
            </div>
            {game.totalMove != null && game.totalMove !== 0 && (
              <div style={{
                color: Math.abs(game.totalMove) >= 1.5 ? '#ff4d4d' : T.accent,
                fontWeight: 600,
                fontSize: '10px',
                fontFamily: T.font,
              }}>
                {game.totalMove > 0 ? '+' : ''}{game.totalMove}
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: T.muted, fontSize: '13px', fontFamily: T.font }}>—</div>
        )}
      </td>

      {/* ML */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
        {game.moneylineHome != null && game.moneylineAway != null ? (
          <div>
            <div style={{ color: T.textSecondary, fontSize: '11px', fontFamily: T.font }}>
              <span style={{ color: game.moneylineAway < 0 ? T.text : T.textSecondary, fontWeight: game.moneylineAway < 0 ? 700 : 500 }}>
                {game.moneylineAway > 0 ? '+' : ''}{game.moneylineAway}
              </span>
              {' / '}
              <span style={{ color: game.moneylineHome < 0 ? T.text : T.textSecondary, fontWeight: game.moneylineHome < 0 ? 700 : 500 }}>
                {game.moneylineHome > 0 ? '+' : ''}{game.moneylineHome}
              </span>
            </div>
            {game.mlMoveHome != null && game.mlMoveHome !== 0 && (
              <div style={{
                color: Math.abs(game.mlMoveHome) >= 20 ? '#ff4d4d' : T.accent,
                fontWeight: 600,
                fontSize: '10px',
                fontFamily: T.font,
              }}>
                {game.mlMoveHome > 0 ? '+' : ''}{game.mlMoveHome}¢
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: T.muted, fontSize: '13px', fontFamily: T.font }}>—</div>
        )}
      </td>

      {/* MOVE */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
        <div style={{
          color: game.lineMoveAmount != null && game.lineMoveAmount !== 0
            ? (Math.abs(game.lineMoveAmount) >= 1 ? '#ff4d4d' : T.accent)
            : T.muted,
          fontWeight: 700,
          fontSize: '13px',
          fontFamily: T.font,
        }}>
          {moveDisplay()}
        </div>
      </td>

      {/* CONSENSUS */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
        <div style={{ color: T.textSecondary, fontWeight: 600, fontSize: '12px', fontFamily: T.font }}>{consensusDisplay()}</div>
      </td>

      {/* SIGNALS */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle' }}>
        <SignalBadges game={game} />
      </td>

      {/* INTEL */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle' }}>
        <IntelBadges game={game} />
      </td>

      {/* PRO + SHARE */}
      <td style={{ padding: '12px 8px', verticalAlign: 'middle', textAlign: 'center' }}>
        <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
          <button
            onClick={(e) => { e.stopPropagation(); onProReport(game); }}
            style={{
              background: 'rgba(0, 102, 255, 0.15)',
              border: '1px solid rgba(0, 102, 255, 0.4)',
              color: '#4d94ff',
              borderRadius: '6px',
              padding: '5px 10px',
              cursor: 'pointer',
              fontWeight: 800,
              fontSize: '11px',
              fontFamily: T.font,
              whiteSpace: 'nowrap',
            }}
          >
            PRO
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); if (game.status === 'upcoming') onShare(game); }}
            disabled={game.status !== 'upcoming'}
            style={{
              background: 'transparent',
              border: `1px solid ${T.border}`,
              color: game.status === 'upcoming' ? T.textSecondary : T.muted,
              borderRadius: '6px',
              padding: '5px 10px',
              cursor: game.status === 'upcoming' ? 'pointer' : 'not-allowed',
              fontWeight: 600,
              fontSize: '11px',
              fontFamily: T.font,
              whiteSpace: 'nowrap',
              opacity: game.status === 'upcoming' ? 1 : 0.4,
            }}
          >
            Share
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Desktop Table ────────────────────────────────────────────
function GameTable({ games, ncaabLogos, onOpenHsa, onShare, onProReport }: { games: GameView[]; ncaabLogos: Record<string, string>; onOpenHsa: (game: GameView) => void; onShare: (game: GameView) => void; onProReport: (game: GameView) => void }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: T.font }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${T.border}` }}>
            {['GAME', 'SPREAD', 'TOTAL', 'ML', 'MOVE', 'CONSENSUS', 'SIGNALS', 'INTEL', ''].map((col, i) => (
              <th key={col || `empty-${i}`} style={{
                padding: '10px 8px',
                textAlign: col === 'GAME' ? 'left' : 'center',
                color: T.muted,
                fontSize: '10px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                fontFamily: T.font,
              }}>
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {games.map((game) => (
            <GameTableRow key={game.id} game={game} ncaabLogos={ncaabLogos} onOpenHsa={onOpenHsa} onShare={onShare} onProReport={onProReport} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mobile Card ──────────────────────────────────────────────
function MobileGameCard({ game, ncaabLogos, onOpenHsa, onShare, onProReport }: { game: GameView; ncaabLogos: Record<string, string>; onOpenHsa: (game: GameView) => void; onShare: (game: GameView) => void; onProReport: (game: GameView) => void }) {
  return (
    <div
      onClick={() => onOpenHsa(game)}
      style={{
        background: T.panel,
        border: `1px solid ${T.border}`,
        borderRadius: '10px',
        padding: '14px',
        cursor: 'pointer',
      }}
    >
      {/* Header: matchup + scores + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', alignItems: 'center' }}>
          <TeamBadge league={game.league} teamName={game.awayTeam} ncaabLogos={ncaabLogos} size={26} />
          <TeamBadge league={game.league} teamName={game.homeTeam} ncaabLogos={ncaabLogos} size={26} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: T.text, fontWeight: 600, fontSize: '14px', fontFamily: T.font }}>{game.awayTeam}</span>
            {game.status !== 'upcoming' && game.awayScore != null && (
              <span style={{ color: game.status === 'live' ? '#22c55e' : T.text, fontWeight: 800, fontSize: '16px' }}>{game.awayScore}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ color: T.text, fontWeight: 600, fontSize: '14px', fontFamily: T.font }}>{game.homeTeam}</span>
            {game.status !== 'upcoming' && game.homeScore != null && (
              <span style={{ color: game.status === 'live' ? '#22c55e' : T.text, fontWeight: 800, fontSize: '16px' }}>{game.homeScore}</span>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
            <span style={{ color: T.muted, fontSize: '10px', fontWeight: 500, fontFamily: T.font }}>{game.league}</span>
            <span style={{ color: statusColor(game.status), fontWeight: 700, fontSize: '10px', fontFamily: T.font }}>
              {statusLabel(game)}
            </span>
            {game.status === 'upcoming' && (
              <span style={{ color: T.muted, fontSize: '10px', fontFamily: T.font }}>
                {formatGameTime(game.gameTime)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Spread + Total + ML + Move + Consensus */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px', marginBottom: '10px' }}>
        <div>
          <div style={{ color: T.muted, fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font }}>{game.status === 'live' ? 'Live Spd' : 'Spread'}</div>
          <div style={{ color: T.text, fontWeight: 700, fontSize: '12px', fontFamily: T.font, marginTop: '2px' }}>
            {game.currentSpread != null ? game.currentSpread : '—'}
          </div>
        </div>
        <div>
          <div style={{ color: T.muted, fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font }}>{game.status === 'live' ? 'Live Tot' : 'Total'}</div>
          <div style={{ color: T.text, fontWeight: 700, fontSize: '12px', fontFamily: T.font, marginTop: '2px' }}>
            {game.currentTotal != null ? game.currentTotal : '—'}
          </div>
          {game.totalMove != null && game.totalMove !== 0 && (
            <div style={{ color: Math.abs(game.totalMove) >= 1.5 ? '#ff4d4d' : T.accent, fontWeight: 600, fontSize: '9px', fontFamily: T.font }}>
              {game.totalMove > 0 ? '+' : ''}{game.totalMove}
            </div>
          )}
        </div>
        <div>
          <div style={{ color: T.muted, fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font }}>ML</div>
          {game.moneylineHome != null && game.moneylineAway != null ? (
            <div style={{ marginTop: '2px' }}>
              <div style={{ color: game.moneylineAway < 0 ? T.text : T.textSecondary, fontWeight: game.moneylineAway < 0 ? 700 : 500, fontSize: '11px', fontFamily: T.font }}>
                {game.moneylineAway > 0 ? '+' : ''}{game.moneylineAway}
              </div>
              <div style={{ color: game.moneylineHome < 0 ? T.text : T.textSecondary, fontWeight: game.moneylineHome < 0 ? 700 : 500, fontSize: '11px', fontFamily: T.font }}>
                {game.moneylineHome > 0 ? '+' : ''}{game.moneylineHome}
              </div>
              {game.mlMoveHome != null && game.mlMoveHome !== 0 && (
                <div style={{ color: Math.abs(game.mlMoveHome) >= 20 ? '#ff4d4d' : T.accent, fontWeight: 600, fontSize: '9px', fontFamily: T.font }}>
                  {game.mlMoveHome > 0 ? '+' : ''}{game.mlMoveHome}¢
                </div>
              )}
            </div>
          ) : (
            <div style={{ color: T.muted, fontSize: '12px', fontFamily: T.font, marginTop: '2px' }}>—</div>
          )}
        </div>
        <div>
          <div style={{ color: T.muted, fontSize: '8px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font }}>Move</div>
          <div style={{
            color: game.lineMoveAmount != null && game.lineMoveAmount !== 0
              ? (Math.abs(game.lineMoveAmount) >= 1 ? '#ff4d4d' : T.accent)
              : T.muted,
            fontWeight: 700,
            fontSize: '13px',
            fontFamily: T.font,
            marginTop: '2px',
          }}>
            {game.lineMoveAmount != null ? `${game.lineMoveAmount > 0 ? '+' : ''}${game.lineMoveAmount}` : '—'}
          </div>
        </div>
        <div>
          <div style={{ color: T.muted, fontSize: '9px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font }}>Consensus</div>
          <div style={{ color: T.textSecondary, fontWeight: 600, fontSize: '12px', fontFamily: T.font, marginTop: '2px' }}>
            {game.publicBetsPct != null ? `${game.awayBetsPct ?? (100 - game.publicBetsPct)}/${game.publicBetsPct}` : '—'}
          </div>
        </div>
      </div>

      {/* Badges */}
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        <SignalBadges game={game} />
        <IntelBadges game={game} />
      </div>

      {/* Intel reasons */}
      {game.isResistance && game.resistanceReason && (
        <div style={{ color: '#38bdf8', fontSize: '11px', fontWeight: 500, marginTop: '8px', fontFamily: T.font }}>{game.resistanceReason}</div>
      )}
      {game.isFakeSteam && game.fakeSteamReason && (
        <div style={{ color: '#facc15', fontSize: '11px', fontWeight: 500, marginTop: '4px', fontFamily: T.font }}>{game.fakeSteamReason}</div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '10px' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onProReport(game); }}
          style={{
            background: 'rgba(0, 102, 255, 0.15)',
            border: '1px solid rgba(0, 102, 255, 0.4)',
            color: '#4d94ff',
            borderRadius: '6px',
            padding: '6px 10px',
            cursor: 'pointer',
            fontWeight: 800,
            fontSize: '11px',
            fontFamily: T.font,
          }}
        >
          PRO
        </button>
        {game.status === 'upcoming' && (
          <button
            onClick={(e) => { e.stopPropagation(); onShare(game); }}
            style={{
              background: 'transparent',
              border: `1px solid rgba(0, 229, 255, 0.3)`,
              color: T.accent,
              borderRadius: '6px',
              padding: '6px 10px',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '11px',
              fontFamily: T.font,
            }}
          >
            Share
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main Dashboard ───────────────────────────────────────────
export function Dashboard() {
  const { games, loading, lastUpdated, refresh } = useGamesFeed();
  const [ncaabLogos, setNcaabLogos] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchNcaabLogoMap().then(setNcaabLogos);
  }, []);

  // const { logCycle } = useHMCycles(); // HM Cycles hidden for now
  const hasLiveGames = games.some((g) => g.status === 'live');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('live');
  const [leagueFilter, setLeagueFilter] = useState<LeagueFilter>('all');
  const [tournamentFilter, setTournamentFilter] = useState<TournamentFilter>('all');
  const [signalFilter, setSignalFilter] = useState<SignalFilter>('all');
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all');
  const [alertsOnly, setAlertsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [hsaGame, setHsaGame] = useState<GameView | null>(null);
  // const [logCycleGame, setLogCycleGame] = useState<GameView | null>(null); // HM Cycles hidden
  const [shareStudioGame, setShareStudioGame] = useState<GameView | null>(null);
  const [proReportGame, setProReportGame] = useState<GameView | null>(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    if (!loading && !hasLiveGames && statusFilter === 'live') {
      setStatusFilter('upcoming');
    }
  }, [loading, hasLiveGames, statusFilter]);

  const filteredGames = useMemo(() => {
    let result = [...games];
    if (statusFilter !== 'all') result = result.filter((g) => g.status === statusFilter);
    if (leagueFilter !== 'all') result = result.filter((g) => g.league === leagueFilter);
    if (tournamentFilter !== 'all') result = result.filter((g) => g.tournament === tournamentFilter);
    if (signalFilter !== 'all') result = result.filter((g) => matchesSignalFilter(g, signalFilter));
    if (timeFilter !== 'all') result = result.filter((g) => matchesTimeFilter(g, timeFilter));
    if (alertsOnly) result = result.filter((g) => isAlertSignal(g.signalTier));
    const q = search.trim().toLowerCase();
    if (q) result = result.filter((g) => g.homeTeam.toLowerCase().includes(q) || g.awayTeam.toLowerCase().includes(q) || g.league.toLowerCase().includes(q));
    result.sort((a, b) => {
      const signalDiff = getSignalRank(b.signalTier) - getSignalRank(a.signalTier);
      if (signalDiff !== 0) return signalDiff;
      return a.timeToTipMinutes - b.timeToTipMinutes;
    });
    return result;
  }, [games, statusFilter, leagueFilter, tournamentFilter, signalFilter, timeFilter, alertsOnly, search]);

  // Summary counts
  const liveCount = games.filter((g) => g.status === 'live').length;
  const sharpCount = games.filter((g) => isAlertSignal(g.signalTier)).length;
  const rlmCount = games.filter((g) => isRlmSignal(g.signalTier)).length;
  const steamCount = games.filter((g) => isSteamSignal(g.signalTier)).length;
  const resistanceCount = games.filter((g) => g.isResistance).length;
  const fakeSteamCount = games.filter((g) => g.isFakeSteam).length;

  const filterBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? T.accent : 'transparent',
    color: active ? '#000' : T.textSecondary,
    border: active ? 'none' : `1px solid ${T.border}`,
    borderRadius: '6px',
    padding: '7px 14px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '12px',
    fontFamily: T.font,
    transition: 'all 150ms',
  });

  return (
    <div style={{ minHeight: '100vh', background: T.bg, color: T.text, fontFamily: T.font }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <img
              src="/hsi-header.jpg"
              alt="Heard Sports Intelligence"
              style={{ height: '44px', borderRadius: '6px', objectFit: 'contain' }}
            />
            <div style={{
              height: '32px',
              width: '1px',
              background: T.border,
            }} />
            <div>
              <div style={{ color: T.text, fontSize: '15px', fontWeight: 700, fontFamily: T.font, letterSpacing: '0.02em' }}>
                MARKET TRACKER
              </div>
              <div style={{ color: T.textSecondary, fontSize: '11px', fontWeight: 500, fontFamily: T.font, letterSpacing: '0.04em' }}>
                Live market movement intelligence
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ color: T.muted, fontSize: '11px', fontWeight: 500, fontFamily: T.font }}>
              Updated {lastUpdated ? lastUpdated.toLocaleTimeString() : '—'}
            </div>
            <button onClick={refresh} style={{
              background: T.accent,
              color: '#000',
              border: 'none',
              borderRadius: '6px',
              padding: '8px 14px',
              fontWeight: 700,
              fontSize: '12px',
              cursor: 'pointer',
              fontFamily: T.font,
            }}>
              Refresh
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(6, 1fr)',
          gap: '10px',
          marginBottom: '20px',
        }}>
          <SummaryCard label="Live Games" value={liveCount} color="#22c55e" />
          <SummaryCard label="Sharp Signals" value={sharpCount} color={T.accent} />
          <SummaryCard label="RLM" value={rlmCount} color="#00ff9c" />
          <SummaryCard label="Steam" value={steamCount} color="#ff9f1c" />
          <SummaryCard label="Resistance" value={resistanceCount} color="#38bdf8" />
          <SummaryCard label="Fake Steam" value={fakeSteamCount} color="#facc15" />
        </div>

        {/* Filters */}
        <div style={{
          background: T.panel,
          border: `1px solid ${T.border}`,
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '16px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          {/* Row 1: Search + Status + Alerts */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team..."
              style={{
                background: T.bg,
                border: `1px solid ${T.border}`,
                color: T.text,
                borderRadius: '6px',
                padding: '8px 12px',
                minWidth: '160px',
                fontWeight: 500,
                fontFamily: T.font,
                fontSize: '13px',
              }}
            />

            <div style={{ display: 'flex', gap: '3px' }}>
              {(['upcoming', 'live', 'final', 'all'] as StatusFilter[]).map((sf) => (
                <button key={sf} onClick={() => setStatusFilter(sf)} style={filterBtnStyle(statusFilter === sf)}>
                  {sf === 'all' ? 'All' : sf.charAt(0).toUpperCase() + sf.slice(1)}
                </button>
              ))}
            </div>

            <label style={{ display: 'flex', gap: '6px', alignItems: 'center', color: T.textSecondary, fontWeight: 600, fontSize: '12px', fontFamily: T.font, cursor: 'pointer' }}>
              <input type="checkbox" checked={alertsOnly} onChange={(e) => setAlertsOnly(e.target.checked)} style={{ accentColor: T.accent }} />
              Alerts only
            </label>
          </div>

          {/* Row 2: League + Tournament + Signal + Time */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', overflow: 'hidden', width: '100%' }}>
            {/* League */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              <span style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font, marginRight: '2px' }}>League</span>
              {(['all', 'NBA', 'NCAAB', 'NHL', 'MLB'] as LeagueFilter[]).map((lf) => (
                <button key={lf} onClick={() => { setLeagueFilter(lf); if (lf !== 'NCAAB') setTournamentFilter('all'); }} style={filterBtnStyle(leagueFilter === lf)}>
                  {lf === 'all' ? 'All' : lf}
                </button>
              ))}
            </div>

            {/* Tournament — only when NCAAB selected */}
            {leagueFilter === 'NCAAB' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                <span style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font, marginRight: '2px' }}>Tourney</span>
                {([['all', 'All'], ['ncaa_tournament', 'NCAA'], ['nit', 'NIT']] as [TournamentFilter, string][]).map(([tf, label]) => (
                  <button key={tf} onClick={() => setTournamentFilter(tf)} style={filterBtnStyle(tournamentFilter === tf)}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Divider */}
            <div style={{ width: '1px', height: '20px', background: T.border }} />

            {/* Signal */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              <span style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font, marginRight: '2px' }}>Signal</span>
              {([['all', 'All'], ['rlm', 'RLM'], ['steam', 'Steam'], ['sharp_accum', 'Sharp Acc.'], ['freeze', 'Freeze'], ['resistance', 'Resist.'], ['fake_steam', 'Fake St.']] as [SignalFilter, string][]).map(([sf, label]) => (
                <button key={sf} onClick={() => setSignalFilter(sf)} style={filterBtnStyle(signalFilter === sf)}>
                  {label}
                </button>
              ))}
            </div>

            {/* Divider */}
            <div style={{ width: '1px', height: '20px', background: T.border }} />

            {/* Time to tip */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
              <span style={{ color: T.muted, fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', fontFamily: T.font, marginRight: '2px' }}>Time</span>
              {([['all', 'All'], ['lt1h', '<1h'], ['1to3h', '1-3h'], ['gt3h', '3h+']] as [TimeFilter, string][]).map(([tf, label]) => (
                <button key={tf} onClick={() => setTimeFilter(tf)} style={filterBtnStyle(timeFilter === tf)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content */}
        {loading ? (
          <div style={{ color: T.textSecondary, fontWeight: 600, padding: '40px 0', textAlign: 'center', fontFamily: T.font }}>
            Loading board...
          </div>
        ) : filteredGames.length === 0 ? (
          <div style={{ color: T.textSecondary, fontWeight: 600, padding: '40px 0', textAlign: 'center', fontFamily: T.font }}>
            No games match the current filters.
          </div>
        ) : isMobile ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {filteredGames.map((game) => (
              <MobileGameCard key={game.id} game={game} ncaabLogos={ncaabLogos} onOpenHsa={setHsaGame} onShare={setShareStudioGame} onProReport={setProReportGame} />
            ))}
          </div>
        ) : (
          <div style={{ background: T.panel, border: `1px solid ${T.border}`, borderRadius: '10px', overflow: 'hidden' }}>
            <GameTable games={filteredGames} ncaabLogos={ncaabLogos} onOpenHsa={setHsaGame} onShare={setShareStudioGame} onProReport={setProReportGame} />
          </div>
        )}
      </div>

      {hsaGame && <HsaModal game={hsaGame} onClose={() => setHsaGame(null)} onRefresh={refresh} />}
      {/* logCycleGame modal removed — HM Cycles hidden for now */}
      {shareStudioGame && <ShareStudio game={shareStudioGame} onClose={() => setShareStudioGame(null)} />}
      {proReportGame && <ProReport game={proReportGame} onClose={() => setProReportGame(null)} />}
    </div>
  );
}
