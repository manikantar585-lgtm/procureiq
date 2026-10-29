import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Title, Text, FlexBox, AnalyticalTable, SegmentedButton, SegmentedButtonItem, Input, Icon, Button, Card, Dialog, Bar, MessageStrip } from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { RiskTag, StatusTag, MatchStatus, ReasonField, isSelectionCellClick } from '../components/Common.jsx';
import { inr, date } from '../format';
import { downloadCsv, stamp } from '../download';

const OPEN = ['Exception', 'OnHold'];
const TABS = {
  all: { text: 'All', f: () => true },
  pending: { text: 'Pending', f: (i) => ['Matched', 'Exception'].includes(i.status) },
  risk: { text: 'High risk', f: (i) => ['High', 'Critical'].includes(i.riskLevel) && !['Rejected', 'Paid'].includes(i.status) },
  onhold: { text: 'On hold', f: (i) => i.status === 'OnHold' },
  escalated: { text: 'SLA breached', f: (i) => i.escalated && OPEN.includes(i.status) },
  approved: { text: 'Approved', f: (i) => i.status === 'Approved' },
  posted: { text: 'Posted', f: (i) => i.status === 'Posted' },
  paid: { text: 'Paid', f: (i) => i.status === 'Paid' },
  rejected: { text: 'Rejected', f: (i) => i.status === 'Rejected' }
};

const CSV_COLUMNS = [
  ['Invoice', (i) => i.invoiceNumber], ['Vendor', (i) => i.vendorName], ['SAP supplier', (i) => i.vendor_ID], ['PO', (i) => i.poNumber],
  ['Invoice date', (i) => i.invoiceDate], ['Due date', (i) => i.dueDate], ['Gross amount', (i) => i.grossAmount], ['Currency', (i) => i.currency],
  ['3-way match', (i) => i.matchStatus], ['Risk level', (i) => i.riskLevel], ['Risk score', (i) => i.riskScore], ['Status', (i) => i.status],
  ['SLA escalated', (i) => (i.escalated && OPEN.includes(i.status) ? 'yes' : '')], ['SAP document', (i) => i.sapDocument], ['Paid on', (i) => i.paidOn], ['Source', (i) => i.source]
];

const getRowId = (r) => r.ID;
const TABLE_OPTIONS = { getRowId };

export default function Invoices() {
  const navigate = useNavigate();
  const { can, notify } = useApp();
  const [params, setParams] = useSearchParams();
  const tab = TABS[params.get('tab')] ? params.get('tab') : 'all';
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState({});
  const [dialog, setDialog] = useState(null); // 'approve' | 'reject'
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState([]);

  const load = () => { setLoading(true); api.invoices().then(setRows).finally(() => setLoading(false)); };
  useEffect(load, []);
  useEffect(() => setSelectedIds({}), [tab]);

  const data = useMemo(() => {
    const s = search.toLowerCase();
    return rows.filter(TABS[tab].f).filter((i) => !s || [i.invoiceNumber, i.vendorName, i.poNumber].some((v) => (v || '').toLowerCase().includes(s)));
  }, [rows, tab, search]);
  const selected = data.filter((i) => selectedIds[i.ID]);

  const columns = useMemo(() => [
    { Header: 'Invoice', accessor: 'invoiceNumber', minWidth: 150, Cell: ({ value, row }) => (<div className="cell-2"><b>{value}</b><span>{row.original.source}</span></div>) },
    { Header: 'Vendor', accessor: 'vendorName', minWidth: 190, Cell: ({ value, row }) => (<div className="cell-2"><span>{value}</span><span>SAP {row.original.vendor_ID || '—'}</span></div>) },
    { Header: 'PO', accessor: 'poNumber', width: 100 },
    { Header: 'Invoice date', accessor: 'invoiceDate', width: 110, Cell: ({ value }) => date(value) },
    { Header: 'Amount', accessor: 'grossAmount', width: 140, hAlign: 'End', Cell: ({ value }) => <span className="num">{inr(value, 2)}</span>, sortType: (a, b) => Number(a.original.grossAmount) - Number(b.original.grossAmount) },
    { Header: '3-way match', accessor: 'matchStatus', width: 140, Cell: ({ value }) => <MatchStatus status={value} /> },
    { Header: 'Risk', accessor: 'riskScore', width: 120, Cell: ({ row }) => <RiskTag level={row.original.riskLevel} score={row.original.riskScore} />, sortType: (a, b) => Number(a.original.riskScore) - Number(b.original.riskScore) },
    { Header: 'Status', accessor: 'status', width: 140, Cell: ({ value, row }) => <StatusTag status={value} escalated={row.original.escalated} /> }
  ], []);

  const total = data.reduce((s, i) => s + Number(i.grossAmount), 0);

  const runBulk = async () => {
    setBusy(true);
    try {
      const ids = selected.map((i) => i.ID);
      const results = dialog === 'approve' ? await api.bulkApprove(ids, text) : await api.bulkReject(ids, text);
      const ok = results.filter((r) => r.ok).length;
      notify(`${ok} of ${results.length} invoice(s) ${dialog === 'approve' ? 'approved' : 'rejected'}`);
      setFailures(results.filter((r) => !r.ok));
      setDialog(null); setText(''); setSelectedIds({});
      load();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" wrap="Wrap" style={{ gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <Title level="H2" size="H3">Invoice Inbox</Title>
          <Text className="muted">{data.length} invoices · {inr(total)} · processed by the ProcureIQ AI pipeline</Text>
        </div>
        <FlexBox style={{ gap: '0.5rem' }}>
          <Button icon="refresh" design="Transparent" onClick={load} tooltip="Refresh" />
          <Button icon="excel-attachment" design="Transparent" disabled={!data.length} onClick={() => downloadCsv(`procureiq-invoices-${tab}-${stamp()}.csv`, CSV_COLUMNS, data)}>Export CSV</Button>
          <Button icon="upload-to-cloud" design="Emphasized" onClick={() => navigate('/upload')}>Capture invoice</Button>
        </FlexBox>
      </FlexBox>
      {failures.length > 0 && (
        <MessageStrip design="Critical" onClose={() => setFailures([])} style={{ marginBottom: '1rem' }}>
          <b>{failures.length} invoice(s) were skipped:</b> {failures.map((f) => `${f.invoiceNumber || f.ID} - ${f.message}`).join(' · ')}
        </MessageStrip>
      )}
      <Card>
        <FlexBox className="table-toolbar" justifyContent="SpaceBetween" alignItems="Center" wrap="Wrap">
          <SegmentedButton onSelectionChange={(e) => setParams({ tab: e.detail.selectedItems[0].dataset.key })}>
            {Object.entries(TABS).map(([key, t]) => (
              <SegmentedButtonItem key={key} data-key={key} selected={tab === key}>{t.text} ({rows.filter(t.f).length})</SegmentedButtonItem>
            ))}
          </SegmentedButton>
          <Input icon={<Icon name="search" />} placeholder="Search invoice, vendor or PO" value={search} onInput={(e) => setSearch(e.target.value)} style={{ width: 280 }} />
        </FlexBox>
        {can('Approver') && selected.length > 0 && (
          <FlexBox className="bulk-bar" alignItems="Center" style={{ gap: '0.5rem' }}>
            <Text><b>{selected.length}</b> selected · {inr(selected.reduce((s, i) => s + Number(i.grossAmount), 0))}</Text>
            <Button design="Positive" icon="accept" onClick={() => setDialog('approve')}>Approve</Button>
            <Button design="Negative" icon="decline" onClick={() => setDialog('reject')}>Reject</Button>
            <Button design="Transparent" onClick={() => setSelectedIds({})}>Clear</Button>
          </FlexBox>
        )}
        <AnalyticalTable
          data={data}
          columns={columns}
          loading={loading}
          sortable
          visibleRows={14}
          rowHeight={52}
          scaleWidthMode="Smart"
          selectionMode={can('Approver') ? 'Multiple' : 'None'}
          selectionBehavior="RowSelector"
          selectedRowIds={selectedIds}
          reactTableOptions={TABLE_OPTIONS}
          onRowSelect={(e) => setSelectedIds(e.detail.selectedRowIds)}
          onRowClick={(e) => !isSelectionCellClick(e) && navigate(`/invoices/${e.detail.row.original.ID}`)}
          noDataText="No invoices in this view"
        />
      </Card>

      <Dialog
        open={!!dialog}
        headerText={`${dialog === 'approve' ? 'Approve' : 'Reject'} ${selected.length} invoice(s)`}
        onClose={() => setDialog(null)}
        footer={
          <Bar endContent={<>
            <Button design={dialog === 'approve' ? 'Positive' : 'Negative'} disabled={busy || (dialog === 'reject' && !text.trim())} onClick={runBulk}>{dialog === 'approve' ? 'Approve' : 'Reject'}</Button>
            <Button design="Transparent" onClick={() => setDialog(null)}>Cancel</Button>
          </>} />
        }
      >
        <div style={{ width: 'min(440px, 80vw)' }}>
          <MessageStrip design="Information" hideCloseButton>
            Each invoice is checked on its own against the approval matrix (AP-POL-004). Invoices you are not allowed to {dialog} are skipped and listed afterwards.
          </MessageStrip>
          <ReasonField id="bulk-text" label={dialog === 'approve' ? 'Comment (required for invoices with exceptions)' : 'Reason (sent to vendors)'} value={text} onInput={setText}
            placeholder={dialog === 'approve' ? 'e.g. Variances confirmed by buyer in weekly review' : 'e.g. Duplicate submissions - vendors asked to cancel'} />
        </div>
      </Dialog>
    </div>
  );
}
