import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Title, Text, Card, CardHeader, FlexBox, BusyIndicator, MessageStrip, List, ListItemStandard, Button, Tag } from '@ui5/webcomponents-react';
import { ColumnLineChart, Donut, HBars } from '../components/Charts.jsx';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { KpiTile } from '../components/Common.jsx';
import { inr, inrCompact } from '../format';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const RISK_COLORS = { Low: 'var(--sapPositiveColor)', Medium: 'var(--sapCriticalColor)', High: 'var(--sapNegativeColor)', Critical: '#8d0a1f' };

export default function Overview() {
  const { user, status, can } = useApp();
  const navigate = useNavigate();
  const [k, setK] = useState(null);
  const [attention, setAttention] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.kpis(), api.invoices({ $filter: "status eq 'Exception'", $orderby: 'riskScore desc', $top: 6 })])
      .then(([kk, a]) => { setK(kk); setAttention(a); })
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <MessageStrip design="Negative">{error}</MessageStrip>;
  if (!k) return <BusyIndicator active size="L" className="center-busy" />;

  const monthLabel = (m) => new Date(m + '-01').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  const risk = ['Low', 'Medium', 'High', 'Critical'].map((l) => ({ level: l, count: k.riskBreakdown[l] || 0 })).filter((r) => r.count);
  const touchless = Math.round(k.autoMatchedPct);

  return (
    <div className="page">
      <FlexBox justifyContent="SpaceBetween" alignItems="End" wrap="Wrap" style={{ gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <Title level="H2" size="H3">{greeting()}, {user.name.split(' ')[0]}</Title>
          <Text className="muted">{k.pendingApproval} invoices are waiting for a decision · {k.highRisk} need attention before payment</Text>
        </div>
        <FlexBox style={{ gap: '0.5rem' }} wrap="Wrap">
          <Tag design="Information" icon="connected">SAP S/4HANA · {status?.sapMode || '…'}</Tag>
          <Tag design={status?.llmProvider === 'offline' ? 'Neutral' : 'Positive'} icon="ai">GenAI · {status?.llmProvider === 'offline' ? 'offline mode' : status?.llmModel}</Tag>
          <Tag design={status?.mlService === 'UP' ? 'Positive' : 'Critical'} icon="machine">ML · {status?.mlService || '…'}</Tag>
        </FlexBox>
      </FlexBox>

      <div className="kpi-grid">
        <KpiTile icon="money-bills" label="Invoice spend (YTD)" value={inrCompact(k.totalSpend)} sub={`${k.totalInvoices} invoices processed`} />
        <KpiTile icon="sys-enter-2" label="Touchless match rate" value={`${touchless}%`} sub="clean 3-way match on first pass" tone="good" />
        <KpiTile icon="workflow-tasks" label="Pending decision" value={k.pendingApproval} sub={`${k.exceptions} exceptions`} tone="info" onClick={() => navigate('/invoices?tab=pending')} />
        <KpiTile icon="shield" label="High / critical risk" value={k.highRisk} sub="blocked before payment" tone="bad" onClick={() => navigate('/invoices?tab=risk')} />
        <KpiTile icon="wallet" label="Overpayment prevented" value={inrCompact(k.savingsIdentified)} sub="duplicates, variances, over-billing" tone="good" />
        <KpiTile icon="timesheet" label="Avg. AI processing" value={`${(k.avgProcessingMs / 1000).toFixed(2)} s`} sub="vs ~12 min manual" />
        <KpiTile icon="payment-approval" label="Open payables" value={inrCompact(k.openPayables)} sub={`${inrCompact(k.overduePayables)} overdue`} tone={k.overduePayables ? 'bad' : 'neutral'}
          onClick={can('Approver') ? () => navigate('/payments') : undefined} />
        <KpiTile icon="lateness" label="SLA breaches" value={k.slaBreaches} sub={`escalated to Finance Manager · ${k.onHold} on hold`} tone={k.slaBreaches ? 'bad' : 'good'} onClick={() => navigate('/invoices?tab=escalated')} />
      </div>

      <div className="grid-2">
        <Card header={<CardHeader titleText="Invoice volume & spend" subtitleText="By invoice month" />}>
          <div className="chart-pad">
            <ColumnLineChart data={k.monthlyTrend} x="month" xFormat={monthLabel} barFormat={inrCompact}
              bar={{ key: 'amount', label: 'Spend' }} line={{ key: 'invoices', label: 'Invoices' }} />
          </div>
        </Card>
        <Card header={<CardHeader titleText="Risk distribution" subtitleText="Rule engine + ML ensemble" />}>
          <div className="chart-pad">
            <Donut data={risk} label="level" value="count" colors={risk.map((r) => RISK_COLORS[r.level])} centerLabel="invoices" />
          </div>
        </Card>
      </div>

      <div className="grid-2">
        <Card header={<CardHeader titleText="Needs attention" subtitleText="Highest-risk exceptions" action={<Button design="Transparent" onClick={() => navigate('/invoices?tab=risk')}>View all</Button>} />}>
          <List>
            {attention.map((i) => (
              <ListItemStandard key={i.ID} icon="alert" description={`${i.vendorName} · ${inr(i.grossAmount)}`} additionalText={`${i.riskLevel} · ${Math.round(i.riskScore)}`}
                additionalTextState={i.riskLevel === 'Medium' ? 'Critical' : 'Negative'} onClick={() => navigate(`/invoices/${i.ID}`)}>
                {i.invoiceNumber}
              </ListItemStandard>
            ))}
          </List>
        </Card>
        <Card header={<CardHeader titleText="Top vendors by spend" subtitleText="Excludes rejected invoices" />}>
          <div className="chart-pad">
            <HBars data={k.spendByVendor} label="vendor" value="amount" format={inrCompact} />
          </div>
        </Card>
      </div>
      <Text className="muted small">Invoice statuses: {Object.entries(k.statusBreakdown).map(([s, c]) => `${s} ${c}`).join(' · ')}</Text>
    </div>
  );
}
