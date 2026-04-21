import { Loader2, Play } from "lucide-react";

export default function LoadButton({ onClick, label, estimate, loading, disabled }) {
  return (
    <div className="ma-alphalab-load-wrap">
      <button type="button" className="ma-alphalab-loadbtn" onClick={onClick} disabled={disabled || loading}>
        {loading ? (
          <Loader2 className="ma-alphalab-loadbtn__spin" size={16} strokeWidth={2} aria-hidden />
        ) : (
          <Play size={16} strokeWidth={2} aria-hidden />
        )}
        <span>{loading ? "Loading…" : label}</span>
      </button>
      {estimate ? <div className="ma-alphalab-loadbtn__est">{estimate}</div> : null}
    </div>
  );
}
