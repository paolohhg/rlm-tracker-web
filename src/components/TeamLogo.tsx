const NBA_ABBR: Record<string, string> = {
  'atlanta hawks': 'atl',
  'boston celtics': 'bos',
  'brooklyn nets': 'bkn',
  'charlotte hornets': 'cha',
  'chicago bulls': 'chi',
  'cleveland cavaliers': 'cle',
  'dallas mavericks': 'dal',
  'denver nuggets': 'den',
  'detroit pistons': 'det',
  'golden state warriors': 'gs',
  'houston rockets': 'hou',
  'indiana pacers': 'ind',
  'la clippers': 'lac',
  'los angeles clippers': 'lac',
  'los angeles lakers': 'lal',
  'la lakers': 'lal',
  'memphis grizzlies': 'mem',
  'miami heat': 'mia',
  'milwaukee bucks': 'mil',
  'minnesota timberwolves': 'min',
  'new orleans pelicans': 'no',
  'new york knicks': 'ny',
  'oklahoma city thunder': 'okc',
  'orlando magic': 'orl',
  'philadelphia 76ers': 'phi',
  'phoenix suns': 'phx',
  'portland trail blazers': 'por',
  'sacramento kings': 'sac',
  'san antonio spurs': 'sa',
  'toronto raptors': 'tor',
  'utah jazz': 'utah',
  'washington wizards': 'wsh',
};

function getLogoUrl(teamName: string, league: string): string | null {
  const key = teamName.toLowerCase().trim();
  if (league.toLowerCase() === 'nba') {
    const abbr = NBA_ABBR[key];
    if (abbr) return `https://a.espncdn.com/i/teamlogos/nba/500/${abbr}.png`;
  }
  return null;
}

function initials(name: string): string {
  return name.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

interface Props {
  teamName: string;
  league: string;
  size?: number;
}

export function TeamLogo({ teamName, league, size = 28 }: Props) {
  const url = getLogoUrl(teamName, league);

  if (url) {
    return (
      <img
        src={url}
        alt={teamName}
        width={size}
        height={size}
        style={{ objectFit: 'contain', flexShrink: 0 }}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
      />
    );
  }

  return (
    <span style={{
      width: size, height: size, borderRadius: '50%',
      background: 'rgba(255,255,255,0.06)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.35, fontWeight: 700, color: '#64748b',
      flexShrink: 0, fontFamily: 'monospace',
    }}>
      {initials(teamName)}
    </span>
  );
}
