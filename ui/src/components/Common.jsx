import { Tag, ObjectStatus, Icon, Text, Title, FlexBox } from '@ui5/webcomponents-react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { RISK_STATE, STATUS_DESIGN } from '../format';

marked.setOptions({ gfm: true, breaks: true });

export function Markdown({ text, className = '' }) {
  const html = DOMPurify.sanitize(marked.parse(text || ''));
  return <div className={`md ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function RiskTag({ level, score }) {
  const design = { Low: 'Positive', Medium: 'Critical', High: 'Negative', Critical: 'Negative' }[level] || 'Neutral';
  return (
    <Tag design={design} className={level === 'Critical' ? 'tag-critical' : ''}>
      {level}{score !== undefined && score !== null ? ` · ${Math.round(score)}` : ''}
    </Tag>
  );
}

export function StatusTag({ status }) {
  return <Tag design={STATUS_DESIGN[status] || 'Neutral'} hideStateIcon>{status}</Tag>;
}

export function MatchStatus({ status }) {
  const map = { MATCHED: ['Positive', '3-way matched'], EXCEPTION: ['Critical', 'Variance'], NO_PO: ['Negative', 'No PO'] };
  const [state, text] = map[status] || ['None', status];
  return <ObjectStatus state={state} showDefaultIcon>{text}</ObjectStatus>;
}

export function RiskObjectStatus({ level }) {
  return <ObjectStatus state={RISK_STATE[level] || 'None'} showDefaultIcon>{level}</ObjectStatus>;
}

export function KpiTile({ icon, label, value, sub, tone = 'neutral', onClick }) {
  return (
    <div className={`kpi kpi-${tone} ${onClick ? 'kpi-click' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined}>
      <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
        <span className="kpi-icon"><Icon name={icon} /></span>
        <Text className="kpi-label">{label}</Text>
      </FlexBox>
      <div className="kpi-value">{value}</div>
      {sub && <Text className="kpi-sub">{sub}</Text>}
    </div>
  );
}

export function SectionTitle({ children, icon }) {
  return (
    <FlexBox alignItems="Center" style={{ gap: '0.5rem', margin: '0 0 0.75rem' }}>
      {icon && <Icon name={icon} className="section-icon" />}
      <Title level="H5" size="H5">{children}</Title>
    </FlexBox>
  );
}

export function RiskGauge({ score = 0, level }) {
  const s = Math.max(0, Math.min(100, Number(score)));
  const color = { Low: 'var(--sapPositiveColor)', Medium: 'var(--sapCriticalColor)', High: 'var(--sapNegativeColor)', Critical: 'var(--sapNegativeColor)' }[level] || 'var(--sapNeutralColor)';
  const r = 34, c = 2 * Math.PI * r;
  return (
    <div className="gauge" title={`Risk ${s}/100`}>
      <svg viewBox="0 0 84 84" width="84" height="84" aria-hidden="true">
        <circle cx="42" cy="42" r={r} fill="none" stroke="var(--sapList_BorderColor)" strokeWidth="8" />
        <circle cx="42" cy="42" r={r} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(s / 100) * c} ${c}`} transform="rotate(-90 42 42)" />
      </svg>
      <div className="gauge-label"><b>{Math.round(s)}</b><span>risk</span></div>
    </div>
  );
}
