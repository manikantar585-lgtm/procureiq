// Lightweight, dependency-free SVG charts styled with SAP theming variables (works in light & dark).
import { useState } from 'react';

const C = ['var(--sapChart_OrderedColor_1)', 'var(--sapChart_OrderedColor_2)', 'var(--sapChart_OrderedColor_3)', 'var(--sapChart_OrderedColor_4)', 'var(--sapChart_OrderedColor_5)'];

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

/** Columns (primary measure) with an optional line (secondary measure) on its own axis. */
export function ColumnLineChart({ data, x, bar, line, xFormat = (v) => v, barFormat = (v) => v, height = 280 }) {
  const [hover, setHover] = useState(null);
  const W = 640, H = height, P = { l: 64, r: 44, t: 16, b: 34 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const bmax = niceMax(Math.max(...data.map((d) => d[bar.key]), 0));
  const lmax = line ? niceMax(Math.max(...data.map((d) => d[line.key]), 0)) : 1;
  const step = iw / Math.max(1, data.length);
  const bw = Math.min(56, step * 0.55);
  const yb = (v) => P.t + ih - (v / bmax) * ih;
  const yl = (v) => P.t + ih - (v / lmax) * ih;
  const cx = (i) => P.l + step * i + step / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`${bar.label} by ${x}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={P.t + ih - t * ih} y2={P.t + ih - t * ih} className="grid" />
            <text x={P.l - 8} y={P.t + ih - t * ih + 4} className="axis" textAnchor="end">{barFormat(bmax * t)}</text>
            {line && <text x={W - P.r + 8} y={P.t + ih - t * ih + 4} className="axis">{Math.round(lmax * t)}</text>}
          </g>
        ))}
        {data.map((d, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={cx(i) - step / 2} y={P.t} width={step} height={ih} fill="transparent" />
            <rect x={cx(i) - bw / 2} y={yb(d[bar.key])} width={bw} height={Math.max(0, P.t + ih - yb(d[bar.key]))} rx="4" fill={bar.color || C[0]} opacity={hover === null || hover === i ? 1 : 0.55} />
            <text x={cx(i)} y={H - 10} className="axis" textAnchor="middle">{xFormat(d[x])}</text>
          </g>
        ))}
        {line && (
          <>
            <polyline fill="none" stroke={line.color || C[4]} strokeWidth="2.5" points={data.map((d, i) => `${cx(i)},${yl(d[line.key])}`).join(' ')} />
            {data.map((d, i) => <circle key={i} cx={cx(i)} cy={yl(d[line.key])} r="4" fill="var(--sapGroup_ContentBackground)" stroke={line.color || C[4]} strokeWidth="2.5" />)}
          </>
        )}
        {hover !== null && (
          <g transform={`translate(${Math.min(cx(hover) + 10, W - 170)}, ${P.t + 4})`} pointerEvents="none">
            <rect width="160" height={line ? 54 : 38} rx="6" className="tip" />
            <text x="10" y="16" className="tip-title">{xFormat(data[hover][x])}</text>
            <text x="10" y="32" className="tip-text">{bar.label}: {barFormat(data[hover][bar.key])}</text>
            {line && <text x="10" y="47" className="tip-text">{line.label}: {data[hover][line.key]}</text>}
          </g>
        )}
      </svg>
      <div className="legend">
        <span><i style={{ background: bar.color || C[0] }} />{bar.label}</span>
        {line && <span><i className="legend-line" style={{ background: line.color || C[4] }} />{line.label}</span>}
      </div>
    </div>
  );
}

/** Donut with centre total and legend. */
export function Donut({ data, label = 'label', value = 'value', colors = C, centerLabel = 'Total', size = 220 }) {
  const [hover, setHover] = useState(null);
  const total = data.reduce((s, d) => s + d[value], 0) || 1;
  const r = 80, w = 26, cxy = 110, circ = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 220 220" width={size} height={size} role="img" aria-label="distribution">
        <circle cx={cxy} cy={cxy} r={r} fill="none" stroke="var(--sapList_BorderColor)" strokeWidth={w} />
        {data.map((d, i) => {
          const frac = d[value] / total;
          const el = (
            <circle key={i} cx={cxy} cy={cxy} r={r} fill="none" stroke={colors[i % colors.length]} strokeWidth={hover === i ? w + 6 : w}
              strokeDasharray={`${Math.max(0, frac * circ - 2)} ${circ}`} strokeDashoffset={-acc * circ} transform={`rotate(-90 ${cxy} ${cxy})`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ transition: 'stroke-width .15s' }} />
          );
          acc += frac;
          return el;
        })}
        <text x={cxy} y={cxy - 4} textAnchor="middle" className="donut-total">{hover === null ? total : data[hover][value]}</text>
        <text x={cxy} y={cxy + 18} textAnchor="middle" className="axis">{hover === null ? centerLabel : data[hover][label]}</text>
      </svg>
      <div className="donut-legend">
        {data.map((d, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <i style={{ background: colors[i % colors.length] }} />
            <span>{d[label]}</span>
            <b>{d[value]}</b>
            <span className="muted">{Math.round((d[value] / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Horizontal bar list (ranking). */
export function HBars({ data, label, value, format = (v) => v, color = C[1], max = 8 }) {
  const rows = data.slice(0, max);
  const top = Math.max(...rows.map((d) => d[value]), 1);
  return (
    <div className="hbars">
      {rows.map((d, i) => (
        <div key={i} className="hbar-row" title={`${d[label]}: ${format(d[value])}`}>
          <span className="hbar-label">{d[label]}</span>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(d[value] / top) * 100}%`, background: color }} /></div>
          <span className="hbar-value">{format(d[value])}</span>
        </div>
      ))}
    </div>
  );
}
