import {
  Search,
  LineChart,
  Bot,
  Trophy,
  Wallet,
  Settings,
  LayoutDashboard
} from "lucide-react";

const NAV = [
  { id: "search", label: "Search", Icon: Search },
  { id: "backtest", label: "Backtest", Icon: LineChart },
  { id: "papertrade", label: "Trading", Icon: Wallet },
  { id: "rankings", label: "Strategy Rankings", Icon: Trophy },
  { id: "rl", label: "RL Agent", Icon: Bot }
];

export default function Sidebar({ tab, setTab, onRankingsEnter }) {
  return (
    <aside className="ma-sidebar" aria-label="Main navigation">
      <div className="ma-sidebar__brand">
        <span className="ma-sidebar__mark">MA</span>
        <span className="ma-sidebar__logo">Market Analysis</span>
      </div>
      <nav className="ma-sidebar__nav">
        {NAV.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            className={
              "ma-sidebar__item" + (tab === id ? " ma-sidebar__item--active" : "")
            }
            onClick={() => {
              setTab(id);
              if (id === "rankings" && onRankingsEnter) onRankingsEnter();
            }}
            title={label}
          >
            <Icon aria-hidden />
            <span className="ma-sidebar__label">{label}</span>
          </button>
        ))}
      </nav>
      <div className="ma-sidebar__footer">
        <button
          type="button"
          className={
            "ma-sidebar__item" + (tab === "about" ? " ma-sidebar__item--active" : "")
          }
          onClick={() => setTab("about")}
          title="About"
        >
          <Settings aria-hidden />
          <span className="ma-sidebar__label">About</span>
        </button>
      </div>
    </aside>
  );
}

/** Minimal sidebar for standalone paper report: return to dashboard. */
export function SidebarStandalone({ onHome }) {
  return (
    <aside className="ma-sidebar" aria-label="Report navigation">
      <div className="ma-sidebar__brand">
        <span className="ma-sidebar__mark">MA</span>
        <span className="ma-sidebar__logo">Market Analysis</span>
      </div>
      <nav className="ma-sidebar__nav">
        <button
          type="button"
          className="ma-sidebar__item ma-sidebar__item--active"
          onClick={onHome}
          title="Dashboard"
        >
          <LayoutDashboard aria-hidden />
          <span className="ma-sidebar__label">Dashboard</span>
        </button>
      </nav>
      <div className="ma-sidebar__footer" />
    </aside>
  );
}
