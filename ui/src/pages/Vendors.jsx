import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Title, Text, Card, CardHeader, AnalyticalTable, ProgressIndicator, FlexBox, Label, Tag, List, ListItemStandard, BusyIndicator, Button } from '@ui5/webcomponents-react';
import { api } from '../api';
import { inr, date } from '../format';

const tone = (s) => (s >= 45 ? 'Negative' : s >= 20 ? 'Critical' : 'Positive');

export default function Vendors() {
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [sel, setSel] = useState(null);

  useEffect(() => { api.vendors().then((v) => { setRows(v); setSel(v[0] || null); }); }, []);

  const data = useMemo(() => (rows || []).map((v) => {
    const live = v.invoices.filter((i) => i.status !== 'Rejected');
    return { ...v, count: v.invoices.length, spend: live.reduce((s, i) => s + Number(i.grossAmount), 0), open: v.invoices.filter((i) => i.status === 'Exception').length,
      ageDays: Math.round((Date.now() - new Date(v.onboardedOn)) / 86400000) };
  }), [rows]);

  if (!rows) return <BusyIndicator active size="L" className="center-busy" />;

  const columns = [
    { Header: 'Vendor', accessor: 'name', minWidth: 230, Cell: ({ value, row }) => <div className="cell-2"><b>{value}</b><span>SAP {row.original.ID} · {row.original.category} · {row.original.city}</span></div> },
    { Header: 'Invoices', accessor: 'count', width: 80, hAlign: 'End' },
    { Header: 'Spend', accessor: 'spend', width: 140, hAlign: 'End', Cell: ({ value }) => inr(value) },
    { Header: 'Open', accessor: 'open', width: 70, hAlign: 'End' },
    { Header: 'Vendor risk', accessor: 'riskScore', width: 180, Cell: ({ value }) => <ProgressIndicator value={Math.round(Number(value))} valueState={tone(Number(value))} displayValue={`${Math.round(Number(value))} / 100`} style={{ width: '100%' }} /> }
  ];

  const s = sel && data.find((d) => d.ID === sel.ID);

  return (
    <div className="page">
      <Title level="H2" size="H3">Vendor Risk</Title>
      <Text className="muted">Supplier master replicated from SAP S/4HANA (A_Supplier) with a rolling risk score from ProcureIQ findings</Text>
      <div className="grid-main-side" style={{ marginTop: '1rem' }}>
        <Card>
          <AnalyticalTable data={data} columns={columns} sortable rowHeight={56} visibleRows={10} scaleWidthMode="Smart" selectionMode="Single" selectionBehavior="RowOnly"
            onRowSelect={(e) => setSel(e.detail.row.original)} />
        </Card>
        {s && (
          <Card header={<CardHeader titleText={s.name} subtitleText={`SAP supplier ${s.ID} · ${s.category}`} />}>
            <div className="side-card">
              <FlexBox wrap="Wrap" style={{ gap: '1rem 2rem' }}>
                <div className="field"><Label>GSTIN</Label><div>{s.gstin}</div></div>
                <div className="field"><Label>Payment terms</Label><div>{s.paymentTerms}</div></div>
                <div className="field"><Label>Onboarded</Label><div>{date(s.onboardedOn)} {s.ageDays < 90 && <Tag design="Critical">New vendor</Tag>}</div></div>
                <div className="field"><Label>Bank account (master)</Label><div className="mono">{s.bankAccount}</div></div>
              </FlexBox>
              <Label style={{ display: 'block', marginTop: '1rem' }}>Invoices</Label>
              <List>
                {s.invoices.map((i) => (
                  <ListItemStandard key={i.ID} description={`${date(i.invoiceDate)} · ${i.status}`} additionalText={`${i.riskLevel}`}
                    additionalTextState={i.riskLevel === 'Low' ? 'Positive' : i.riskLevel === 'Medium' ? 'Critical' : 'Negative'} onClick={() => navigate(`/invoices/${i.ID}`)}>
                    {i.invoiceNumber} · {inr(i.grossAmount)}
                  </ListItemStandard>
                ))}
              </List>
              <Button design="Transparent" icon="ai" onClick={() => navigate(`/copilot?q=${encodeURIComponent(`Analyse vendor ${s.name} for risk`)}`)}>Ask Copilot about this vendor</Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
