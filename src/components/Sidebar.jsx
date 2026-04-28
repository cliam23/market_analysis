import {
  Search,
  LineChart,
  Bot,
  Wallet,
  FlaskConical,
  Settings,
  LayoutDashboard,
  RefreshCw
} from "lucide-react";

function OptionsNavIcon(props) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      <path d="M3 3v18h18M7 16l4-4 4 4 4-8" />
    </svg>
  );
}

const NAV = [
  { id: "dashboard", label: "Dashboard", Icon: LayoutDashboard },
  { id: "search", label: "Search", Icon: Search },
  { id: "backtest", label: "Backtest", Icon: LineChart },
  { id: "papertrade", label: "Trading", Icon: Wallet },
  { id: "alphalab", label: "Alpha Lab", Icon: FlaskConical },
  { id: "options", label: "Options", Icon: OptionsNavIcon },
  { id: "wheel", label: "Wheel", Icon: RefreshCw },
  { id: "rl", label: "RL Agent", Icon: Bot }
];

export default function Sidebar({ tab, setTab }) {
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
            onClick={() => setTab(id)}
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
