import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

type ScoreRow = {
  sport: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  period: string | null;
  status: string;
};

export default function TickerBar() {
  const [games, setGames] = useState<ScoreRow[]>([]);

  async function fetchLive() {
    const { data } = await supabase
      .from("game_scores")
      .select("*")
      .eq("status", "in_progress");

    setGames(data ?? []);
  }

  useEffect(() => {
    fetchLive();
    const i = setInterval(fetchLive, 30000);
    return () => clearInterval(i);
  }, []);

  if (!games.length) return null;

  return (
    <div style={{
      width: "100%",
      background: "#111",
      color: "#fff",
      padding: "8px 16px",
      fontSize: "14px",
      display: "flex",
      gap: "32px",
      overflowX: "auto"
    }}>
      <strong>LIVE</strong>

      {games.map((g, i) => (
        <span key={i}>
          {g.away_team} {g.away_score} – {g.home_team} {g.home_score}
          {g.period && ` | Q${g.period}`}
        </span>
      ))}
    </div>
  );
}
