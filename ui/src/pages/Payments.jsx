import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Title, Text, Card, CardHeader, FlexBox, BusyIndicator, MessageStrip, AnalyticalTable, Button, DatePicker, Select, Option, Label, Dialog, Bar, Tag, ObjectStatus
} from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { KpiTile, isSelectionCellClick } from '../components/Common.jsx';
import { ColumnLineChart, HBars } from '../components/Charts.jsx';
import { inr, inrCompact, date, dateTime, today } from '../format';
import { downloadCsv } from '../download';

const HORIZONS = [0, 7, 14, 30];
const getRowId = (r) => r.ID;
const TABLE_OPTIONS = { getRowId };
const dueState = (d) => (d < 0 ? 'Negative' : d <= 7 ? 'Critical' : 'None');

export default function Payments() {
  const navigate = useNavigate();
  const { can, notify, settings } = useApp();
  const [paymentDate, setPaymentDate] = useState(today());
  const [horizon, setHorizon] = useState(null);
  const [p, setP] = useState(null);
  const [runs, setRuns] = useState([]);
  const [selectedIds, setSelectedIds] = useState({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const horizonDays = horizon ?? settings.paymentHorizonDays ?? 7;

  const load = useCallback(() => {
    setError(null);
    api.paymentProposal(paymentDate, horizonDays).then((res) => {
      setP(res);
      setSelectedIds(Object.fromEntries(res.items.filter((i) => i.include).map((i) => [i.ID, true])));
    }).catch((e) => setError(e.message));
    api.paymentRuns().then(setRuns).catch(() => {});
  }, [paymentDate, horizonDays]);
  useEffect(load, [load]);

  const columns = useMemo(() => [
    { Header: 'Invoice', accessor: 'invoiceNumber', minWidth: 140, Cell: ({ value, row }) => <div className="cell-2"><b>{value}</b><span>{row.original.paymentTerms}</span></div> },
    { Header: 'Vendor', accessor: 'vendorName', minWidth: 190 },
    { Header: 'Due date', accessor: 'dueDate', width: 150, Cell: ({ value, row }) => (
      <div className="cell-2"><span>{date(value)}</span><ObjectStatus state={dueState(row.original.daysToDue)}>{row.original.daysToDue < 0 ? `${-row.original.daysToDue} days overdue` : `in ${row.original.daysToDue} days`}</ObjectStatus></div>
    ) },
    { Header: 'Gross', accessor: 'grossAmount', width: 130, hAlign: 'End', Cell: ({ value }) => <span className="num">{inr(value, 2)}</span> },
    { Header: 'Cash discount', accessor: 'discount', width: 130, hAlign: 'End', Cell: ({ value, row }) => (
      value ? <span className="num text-good">−{inr(value, 2)}</span> : row.original.lostDiscount ? <span className="num muted" title="Discount deadline passed">lost {inr(row.original.lostDiscount)}</span> : '–'
    ) },
    { Header: 'Pay', accessor: 'payAmount', width: 130, hAlign: 'End', Cell: ({ value }) => <b className="num">{inr(value, 2)}</b> },
    { Header: 'Proposal', accessor: 'reason', minWidth: 220, Cell: ({ value, row }) => (
      <ObjectStatus state={row.original.blocked ? 'Negative' : row.original.include ? 'Positive' : 'None'} showDefaultIcon={row.original.blocked || row.original.include} wrappingType="Normal">{value}</ObjectStatus>
    ) }
  ], []);

  if (error) return <div className="page"><MessageStrip design="Negative">{error}</MessageStrip></div>;
  if (!p) return <BusyIndicator active size="L" className="center-busy" />;

  const t = p.totals;
  const selected = p.items.filter((i) => selectedIds[i.ID] && !i.blocked);
  const selPay = selected.reduce((s, i) => s + i.payAmount, 0);
  const selDiscount = selected.reduce((s, i) => s + i.discount, 0);
  const execute = async () => {
    setBusy(true);
    try {
      const run = await api.executePaymentRun(paymentDate, selected.map((i) => i.ID));
      notify(`Payment run ${run.runId} executed: ${run.invoiceCount} invoice(s), ${inr(run.paidAmount)} paid`);
      setConfirm(false); load();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="page">
      <FlexBox justifyContent="SpaceBetween" alignItems="End" wrap="Wrap" style={{ gap: '1rem', marginBottom: '1rem' }}>
        <div>
          <Title level="H2" size="H3">Payments</Title>
          <Text className="muted">Open items posted to SAP S/4HANA · F110-style payment proposal with cash discount capture</Text>
        </div>
        <FlexBox style={{ gap: '1rem' }} alignItems="End" wrap="Wrap">
          <div className="field">
            <Label for="pay-date">Payment date</Label>
            <DatePicker id="pay-date" value={paymentDate} valueFormat="yyyy-MM-dd" displayFormat="dd MMM yyyy" minDate={today()} onChange={(e) => e.detail.valid && e.detail.value && setPaymentDate(e.detail.value)} />
          </div>
          <div className="field">
            <Label for="horizon">Pay invoices due within</Label>
            <Select id="horizon" onChange={(e) => setHorizon(Number(e.detail.selectedOption.value))} style={{ width: 150 }}>
              {[...new Set([...HORIZONS, horizonDays])].sort((a, b) => a - b).map((h) => <Option key={h} value={String(h)} selected={h === horizonDays}>{h} days</Option>)}
            </Select>
          </div>
          <Button icon="refresh" design="Transparent" onClick={load} tooltip="Refresh" />
        </FlexBox>
      </FlexBox>

      <div className="kpi-grid">
        <KpiTile icon="money-bills" label="Open payables" value={inrCompact(t.openAmount)} sub={`${t.openItems} posted invoice(s)`} />
        <KpiTile icon="lateness" label="Overdue" value={inrCompact(t.overdueAmount)} sub={`${t.overdueItems} invoice(s) past due date`} tone={t.overdueItems ? 'bad' : 'good'} />
        <KpiTile icon="batch-payments" label="Proposed payment" value={inrCompact(t.payAmount)} sub={`${t.proposedItems} invoice(s) on ${date(paymentDate)}`} tone="info" />
        <KpiTile icon="wallet" label="Cash discount captured" value={inrCompact(t.discount)} sub={`${inrCompact(t.lostDiscount)} lost to late payment`} tone={t.lostDiscount > t.discount ? 'bad' : 'good'} />
      </div>
      {t.blockedItems > 0 && <MessageStrip design="Negative" hideCloseButton style={{ marginBottom: '1rem' }}>{t.blockedItems} invoice(s) are excluded because the vendor is blocked for payment.</MessageStrip>}

      <div className="grid-2">
        <Card header={<CardHeader titleText="Payables aging" subtitleText={`Relative to ${date(paymentDate)}`} />}>
          <div className="chart-pad"><HBars data={p.aging} label="bucket" value="amount" format={inrCompact} max={6} /></div>
        </Card>
        <Card header={<CardHeader titleText="Cash-out forecast" subtitleText="Weekly, from the payment date (blocked vendors excluded)" />}>
          <div className="chart-pad">
            <ColumnLineChart data={p.forecast} x="week" barFormat={inrCompact} bar={{ key: 'amount', label: 'Amount to pay' }} line={{ key: 'invoices', label: 'Invoices' }} height={240} />
          </div>
        </Card>
      </div>

      <Card header={<CardHeader titleText="Payment proposal" subtitleText={can('Manager') ? 'Select the invoices to pay, then execute the run' : 'Payment runs are executed by the Finance Manager (segregation of duties)'}
        action={<FlexBox style={{ gap: '0.5rem' }} alignItems="Center">
          <Button design="Transparent" icon="excel-attachment" onClick={() => downloadCsv(`payment-proposal-${paymentDate}.csv`, [
            ['Invoice', (i) => i.invoiceNumber], ['Vendor', (i) => i.vendorName], ['Due date', (i) => i.dueDate], ['Days to due', (i) => i.daysToDue], ['Gross', (i) => i.grossAmount],
            ['Discount', (i) => i.discount], ['Pay amount', (i) => i.payAmount], ['Proposed', (i) => (i.include ? 'yes' : 'no')], ['Reason', (i) => i.reason]], p.items)}>Export</Button>
          {can('Manager') && <Button design="Emphasized" icon="payment-approval" disabled={!selected.length} onClick={() => setConfirm(true)}>Execute run ({selected.length})</Button>}
        </FlexBox>} />}>
        <AnalyticalTable
          data={p.items}
          columns={columns}
          rowHeight={56}
          visibleRows={Math.min(12, Math.max(3, p.items.length))}
          scaleWidthMode="Smart"
          selectionMode={can('Manager') ? 'Multiple' : 'None'}
          selectionBehavior="RowSelector"
          selectedRowIds={selectedIds}
          reactTableOptions={TABLE_OPTIONS}
          onRowSelect={(e) => setSelectedIds(e.detail.selectedRowIds)}
          onRowClick={(e) => !isSelectionCellClick(e) && navigate(`/invoices/${e.detail.row.original.ID}`)}
          noDataText="No open items - post approved invoices to SAP first"
        />
      </Card>

      <Card header={<CardHeader titleText="Payment runs" subtitleText="Executed runs (most recent first)" />} style={{ marginTop: '1rem' }}>
        <AnalyticalTable
          data={runs}
          rowHeight={44}
          visibleRows={Math.max(2, Math.min(6, runs.length))}
          scaleWidthMode="Smart"
          noDataText="No payment run executed yet"
          columns={[
            { Header: 'Run', accessor: 'runId', width: 150, Cell: ({ value }) => <b className="mono">{value}</b> },
            { Header: 'Value date', accessor: 'paymentDate', width: 120, Cell: ({ value }) => date(value) },
            { Header: 'Invoices', accessor: 'invoiceCount', width: 90, hAlign: 'End' },
            { Header: 'Gross', accessor: 'grossAmount', width: 140, hAlign: 'End', Cell: ({ value }) => inr(value, 2) },
            { Header: 'Discount', accessor: 'discountAmount', width: 120, hAlign: 'End', Cell: ({ value }) => inr(value, 2) },
            { Header: 'Paid', accessor: 'paidAmount', width: 140, hAlign: 'End', Cell: ({ value }) => <b>{inr(value, 2)}</b> },
            { Header: 'Executed', accessor: 'createdAt', minWidth: 160, Cell: ({ value, row }) => `${dateTime(value)} · ${row.original.executedBy}` }
          ]}
        />
      </Card>

      <Dialog open={confirm} headerText="Execute payment run" onClose={() => setConfirm(false)}
        footer={<Bar endContent={<>
          <Button design="Emphasized" disabled={busy} onClick={execute}>Pay {inr(selPay, 2)}</Button>
          <Button design="Transparent" onClick={() => setConfirm(false)}>Cancel</Button>
        </>} />}>
        <div style={{ width: 'min(420px, 80vw)' }} className="confirm-body">
          <Text>Pay <b>{selected.length}</b> invoice(s) with value date <b>{date(paymentDate)}</b>.</Text>
          <FlexBox justifyContent="SpaceBetween"><Text>Gross</Text><b className="num">{inr(selected.reduce((s, i) => s + i.grossAmount, 0), 2)}</b></FlexBox>
          <FlexBox justifyContent="SpaceBetween"><Text>Cash discount</Text><b className="num">−{inr(selDiscount, 2)}</b></FlexBox>
          <FlexBox justifyContent="SpaceBetween"><Text>Payment amount</Text><b className="num">{inr(selPay, 2)}</b></FlexBox>
          <Tag design="Information" hideStateIcon>Invoices move to status Paid; every payment is written to the audit trail</Tag>
        </div>
      </Dialog>
    </div>
  );
}
