import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Title, Text, FlexBox, AnalyticalTable, SegmentedButton, SegmentedButtonItem, Input, Icon, Button, Card } from '@ui5/webcomponents-react';
import { api } from '../api';
import { RiskTag, StatusTag, MatchStatus } from '../components/Common.jsx';
import { inr, date } from '../format';

const TABS = {
  all: { text: 'All', f: () => true },
  pending: { text: 'Pending decision', f: (i) => ['Matched', 'Exception'].includes(i.status) },
  risk: { text: 'High risk', f: (i) => ['High', 'Critical'].includes(i.riskLevel) && i.status !== 'Rejected' },
  approved: { text: 'Approved', f: (i) => i.status === 'Approved' },
  posted: { text: 'Posted to SAP', f: (i) => i.status === 'Posted' },
  rejected: { text: 'Rejected', f: (i) => i.status === 'Rejected' }
};

export default function Invoices() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'all';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = () => { setLoading(true); api.invoices().then(setRows).finally(() => setLoading(false)); };
  useEffect(load, []);

  const data = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter(TABS[tab].f).filter((i) => !s || [i.invoiceNumber, i.vendorName, i.poNumber].some((v) => (v || '').toLowerCase().includes(s)));
  }, [rows, tab, search]);

  const columns = useMemo(() => [
    { Header: 'Invoice', accessor: 'invoiceNumber', minWidth: 150, Cell: ({ value, row }) => (<div className="cell-2"><b>{value}</b><span>{row.original.source}</span></div>) },
    { Header: 'Vendor', accessor: 'vendorName', minWidth: 210, Cell: ({ value, row }) => (<div className="cell-2"><span>{value}</span><span>SAP {row.original.vendor_ID || '—'}</span></div>) },
    { Header: 'PO', accessor: 'poNumber', width: 110 },
    { Header: 'Invoice date', accessor: 'invoiceDate', width: 120, Cell: ({ value }) => date(value) },
    { Header: 'Amount', accessor: 'grossAmount', width: 140, hAlign: 'End', Cell: ({ value }) => <span className="num">{inr(value, 2)}</span>, sortType: (a, b) => Number(a.original.grossAmount) - Number(b.original.grossAmount) },
    { Header: '3-way match', accessor: 'matchStatus', width: 140, Cell: ({ value }) => <MatchStatus status={value} /> },
    { Header: 'Risk', accessor: 'riskScore', width: 120, Cell: ({ row }) => <RiskTag level={row.original.riskLevel} score={row.original.riskScore} />, sortType: (a, b) => Number(a.original.riskScore) - Number(b.original.riskScore) },
    { Header: 'Status', accessor: 'status', width: 120, Cell: ({ value }) => <StatusTag status={value} /> }
  ], []);

  const total = data.reduce((s, i) => s + Number(i.grossAmount), 0);

  return (
    <div className="page">
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" wrap="Wrap" style={{ gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <Title level="H2" size="H3">Invoice Inbox</Title>
          <Text className="muted">{data.length} invoices · {inr(total)} · processed by the ProcureIQ AI pipeline</Text>
        </div>
        <FlexBox style={{ gap: '0.5rem' }}>
          <Button icon="refresh" design="Transparent" onClick={load} tooltip="Refresh" />
          <Button icon="upload-to-cloud" design="Emphasized" onClick={() => navigate('/upload')}>Capture invoice</Button>
        </FlexBox>
      </FlexBox>
      <Card>
        <FlexBox className="table-toolbar" justifyContent="SpaceBetween" alignItems="Center" wrap="Wrap">
          <SegmentedButton onSelectionChange={(e) => setParams({ tab: e.detail.selectedItems[0].dataset.key })}>
            {Object.entries(TABS).map(([key, t]) => (
              <SegmentedButtonItem key={key} data-key={key} selected={tab === key}>{t.text} ({rows.filter(t.f).length})</SegmentedButtonItem>
            ))}
          </SegmentedButton>
          <Input icon={<Icon name="search" />} placeholder="Search invoice, vendor or PO" value={search} onInput={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
        </FlexBox>
        <AnalyticalTable
          data={data}
          columns={columns}
          loading={loading}
          sortable
          visibleRows={14}
          rowHeight={52}
          scaleWidthMode="Smart"
          onRowClick={(e) => navigate(`/invoices/${e.detail.row.original.ID}`)}
          noDataText="No invoices in this view"
        />
      </Card>
    </div>
  );
}
