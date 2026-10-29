import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ObjectPage, ObjectPageTitle, ObjectPageHeader, ObjectPageSection, Title, Text, Label, FlexBox, Button, Toolbar, ToolbarButton,
  BusyIndicator, MessageStrip, AnalyticalTable, ObjectStatus, Dialog, TextArea, Bar, Timeline, TimelineItem, Icon, Breadcrumbs, BreadcrumbsItem, Tag, Link,
  Select, Option, Avatar
} from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { Markdown, RiskTag, StatusTag, MatchStatus, RiskGauge, ReasonField } from '../components/Common.jsx';
import { inr, date, dateTime, LINE_STATE, SEVERITY_ICON, HOLD_CATEGORIES } from '../format';
import { downloadBase64 } from '../download';

const SEV_DESIGN = { Low: 'Information', Medium: 'Critical', High: 'Negative', Critical: 'Negative' };
const AUDIT_ICON = {
  RECEIVED: 'pdf-attachment', EXTRACTED: 'ai', MATCHED: 'inspection', SCORED: 'shield', ROUTED: 'process', APPROVED: 'accept', REJECTED: 'decline',
  POSTED: 'paper-plane', POST_FAILED: 'error', ON_HOLD: 'pause', RELEASED: 'play', ESCALATED: 'lateness', PAID: 'payment-approval'
};
const HOLDABLE = ['Matched', 'Exception', 'Approved'];
const DIALOG = {
  approve: { title: 'Approve', button: 'Approve', design: 'Positive', label: 'Comment', placeholder: 'e.g. Price increase confirmed by buyer, PO amendment 2 pending', ok: 'Invoice approved' },
  reject: { title: 'Reject', button: 'Reject', design: 'Negative', label: 'Reason (sent to vendor)', placeholder: 'e.g. Billed quantity exceeds goods received - please issue credit note', ok: 'Invoice rejected', required: true },
  hold: { title: 'Put on hold', button: 'Put on hold', design: 'Emphasized', label: 'Reason', placeholder: 'e.g. Vendor disputes the short delivery on line 2 - waiting for their reply', ok: 'Invoice put on hold', required: true },
  release: { title: 'Release hold', button: 'Release', design: 'Emphasized', label: 'Resolution (optional)', placeholder: 'e.g. Credit note CN-2231 received and booked', ok: 'Hold released' },
  delete: { title: 'Delete', button: 'Delete permanently', design: 'Negative', label: 'Reason (kept in the audit trail)', placeholder: 'e.g. Test upload / wrong document sent by the vendor', ok: 'Invoice permanently deleted', required: true }
};
const LOCKED_IN_SAP = ['Posted', 'Paid'];

function Field({ label, children }) {
  return (<div className="field"><Label>{label}</Label><div className="field-value">{children ?? '–'}</div></div>);
}

const initials = (name = '') => name.replace(/\(.*\)/, '').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const ageDays = (since) => (since ? Math.floor((Date.now() - new Date(since)) / 86400000) : 0);

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, notify, settings } = useApp();
  const [inv, setInv] = useState(null);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // key of DIALOG
  const [comment, setComment] = useState('');
  const [category, setCategory] = useState('VendorDispute');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.invoice(id).then(setInv).catch((e) => setError(e.message));
    if (can('Approver')) api.audit(id).then((a) => setAudit([...a].reverse())).catch(() => {});
  }, [id, can]);
  useEffect(load, [load]);

  const act = async (fn, okMsg, after = load) => {
    setBusy(true);
    try { await fn(); notify(okMsg); setDialog(null); setComment(''); after(); return true; }
    catch (e) { notify(e.message); return false; }
    finally { setBusy(false); }
  };
  const submitDialog = () => act({
    approve: () => api.approve(inv.ID, comment),
    reject: () => api.reject(inv.ID, comment),
    hold: () => api.hold(inv.ID, category, comment),
    release: () => api.release(inv.ID, comment),
    delete: () => api.deleteInvoice(inv.ID, comment)
  }[dialog], DIALOG[dialog].ok, dialog === 'delete' ? () => navigate('/invoices') : load);
  const postNote = async () => { if (await act(() => api.comment(inv.ID, note), 'Comment added')) setNote(''); };
  const report = () => act(async () => downloadBase64(`audit-report-${inv.invoiceNumber.replace(/[^A-Za-z0-9-]+/g, '_')}.pdf`, await api.auditReport(inv.ID)), 'Audit report downloaded');

  if (error) return <div className="page"><MessageStrip design="Negative">{error}</MessageStrip></div>;
  if (!inv) return <BusyIndicator active size="L" className="center-busy" />;

  const header = inv.matchResults.filter((m) => m.lineNo === 0);
  const lines = inv.matchResults.filter((m) => m.lineNo > 0);
  const decidable = ['Matched', 'Exception'].includes(inv.status);
  const slaOpen = inv.escalated && ['Exception', 'OnHold'].includes(inv.status);
  const rec = /Recommendation:\s*\**\s*(APPROVE|REVIEW|BLOCK)/i.exec(inv.aiSummary || '')?.[1]?.toUpperCase();
  const d = dialog && DIALOG[dialog];

  const matchCols = [
    { Header: 'Line', accessor: 'lineNo', width: 60 },
    { Header: 'PO item', accessor: 'poItem', width: 80 },
    { Header: 'Material', accessor: 'material', width: 130 },
    { Header: 'Description', accessor: 'description', minWidth: 200 },
    { Header: 'Inv. qty', accessor: 'invoiceQty', width: 90, hAlign: 'End' },
    { Header: 'PO qty', accessor: 'poQty', width: 90, hAlign: 'End' },
    { Header: 'GR qty', accessor: 'grQty', width: 90, hAlign: 'End' },
    { Header: 'Inv. price', accessor: 'invoicePrice', width: 110, hAlign: 'End', Cell: ({ value }) => inr(value, 2) },
    { Header: 'PO price', accessor: 'poPrice', width: 110, hAlign: 'End', Cell: ({ value }) => inr(value, 2) },
    { Header: 'Δ price', accessor: 'priceVariancePct', width: 90, hAlign: 'End', Cell: ({ value }) => (value === null || value === undefined ? '–' : `${Number(value) > 0 ? '+' : ''}${Number(value).toFixed(2)}%`) },
    { Header: 'Result', accessor: 'status', width: 230, Cell: ({ value, row }) => <ObjectStatus state={LINE_STATE[value]} showDefaultIcon wrappingType="Normal">{row.original.message}</ObjectStatus> }
  ];
  const itemCols = [
    { Header: '#', accessor: 'lineNo', width: 50 },
    { Header: 'Material', accessor: 'material', width: 140 },
    { Header: 'Description', accessor: 'description', minWidth: 220 },
    { Header: 'Qty', accessor: 'quantity', width: 90, hAlign: 'End', Cell: ({ value, row }) => `${Number(value)} ${row.original.unit || ''}` },
    { Header: 'Unit price', accessor: 'unitPrice', width: 120, hAlign: 'End', Cell: ({ value }) => inr(value, 2) },
    { Header: 'Amount', accessor: 'amount', width: 140, hAlign: 'End', Cell: ({ value }) => inr(value, 2) }
  ];

  return (
    <>
      <ObjectPage
        className="object-page"
        titleArea={
          <ObjectPageTitle
            breadcrumbs={<Breadcrumbs onItemClick={(e) => { e.preventDefault(); navigate('/invoices'); }}><BreadcrumbsItem>Invoice Inbox</BreadcrumbsItem><BreadcrumbsItem>{inv.invoiceNumber}</BreadcrumbsItem></Breadcrumbs>}
            header={<Title level="H2" size="H3">{inv.invoiceNumber}</Title>}
            subHeader={<FlexBox style={{ gap: '0.5rem' }} alignItems="Center"><Text>{inv.vendorName}</Text><StatusTag status={inv.status} escalated={inv.escalated} /><RiskTag level={inv.riskLevel} score={inv.riskScore} /></FlexBox>}
            actionsBar={
              <Toolbar design="Transparent">
                {decidable && can('Approver') && <ToolbarButton design="Positive" icon="accept" text="Approve" onClick={() => setDialog('approve')} />}
                {!['Posted', 'Rejected', 'Paid'].includes(inv.status) && can('Approver') && <ToolbarButton design="Negative" icon="decline" text="Reject" onClick={() => setDialog('reject')} />}
                {inv.status === 'Approved' && can('Approver') && <ToolbarButton design="Emphasized" icon="paper-plane" text="Post to SAP" disabled={busy} onClick={() => act(() => api.post(inv.ID), 'Supplier invoice posted to SAP S/4HANA')} />}
                {HOLDABLE.includes(inv.status) && <ToolbarButton design="Transparent" icon="pause" text="Put on hold" onClick={() => setDialog('hold')} />}
                {inv.status === 'OnHold' && <ToolbarButton design="Emphasized" icon="play" text="Release hold" onClick={() => setDialog('release')} />}
                {can('Approver') && <ToolbarButton design="Transparent" icon="download" text="Audit report (PDF)" disabled={busy} onClick={report} />}
                {can('Manager') && !LOCKED_IN_SAP.includes(inv.status) && <ToolbarButton design="Transparent" icon="delete" text="Delete" onClick={() => setDialog('delete')} />}
                <ToolbarButton design="Transparent" icon="ai" text="Ask Copilot" onClick={() => navigate(`/copilot?q=${encodeURIComponent(`Why is ${inv.invoiceNumber} flagged and what should I do?`)}`)} />
              </Toolbar>
            }
          />
        }
        headerArea={
          <ObjectPageHeader>
            <FlexBox wrap="Wrap" style={{ gap: '2rem' }} alignItems="Center">
              <RiskGauge score={inv.riskScore} level={inv.riskLevel} />
              <div className="header-amount"><Label>Gross amount</Label><div className="big-number">{inr(inv.grossAmount, 2)}</div><Text className="muted">Net {inr(inv.netAmount, 2)} + GST {inr(inv.taxAmount, 2)}</Text></div>
              <Field label="Purchase order">{inv.poNumber ? <Link onClick={() => navigate(`/sap?po=${inv.poNumber}`)}>{inv.poNumber}</Link> : 'none'}</Field>
              <Field label="3-way match"><MatchStatus status={inv.matchStatus} /></Field>
              <Field label="Invoice / due date">{date(inv.invoiceDate)} → {date(inv.dueDate)}</Field>
              <Field label="AI extraction">{inv.extractionEngine} · {Number(inv.extractionConfidence)}%</Field>
              <Field label="SAP document">{inv.sapDocument ? `${inv.sapDocument} / ${inv.sapFiscalYear}` : 'not posted'}</Field>
              {inv.status === 'Paid' && <Field label="Payment">{inr(inv.paidAmount, 2)} on {date(inv.paidOn)}{inv.paymentRun ? ` · ${inv.paymentRun.runId}` : ''}</Field>}
            </FlexBox>
          </ObjectPageHeader>
        }
      >
        <ObjectPageSection id="review" titleText="AI Review">
          {slaOpen && (
            <MessageStrip design="Negative" hideCloseButton icon={<Icon name="lateness" />} className="banner">
              <b>SLA breached.</b> Open {ageDays(inv.status === 'OnHold' ? inv.heldAt : inv.receivedAt)} days (SLA {settings.slaDays ?? 5} days) - escalated to the Finance Manager on {dateTime(inv.escalatedAt)}.
            </MessageStrip>
          )}
          {inv.status === 'OnHold' && (
            <MessageStrip design="Critical" hideCloseButton icon={<Icon name="pause" />} className="banner">
              <b>On hold · {HOLD_CATEGORIES[inv.holdCategory] || inv.holdCategory}</b> since {dateTime(inv.heldAt)} by {inv.heldBy}: {inv.holdReason}
            </MessageStrip>
          )}
          {inv.status === 'Paid' && (
            <MessageStrip design="Positive" hideCloseButton icon={<Icon name="payment-approval" />} className="banner">
              <b>Paid</b> {inr(inv.paidAmount, 2)} on {date(inv.paidOn)}{inv.paymentRun ? ` in payment run ${inv.paymentRun.runId}` : ''}{Number(inv.discountTaken) ? ` · cash discount ${inr(inv.discountTaken, 2)} captured` : ''}.
            </MessageStrip>
          )}
          <div className={`ai-review rec-${(rec || 'none').toLowerCase()}`}>
            <FlexBox alignItems="Center" style={{ gap: '0.5rem', marginBottom: '0.5rem' }}>
              <Icon name="ai" /><b>ProcureIQ reviewer note</b>
              <Tag design="Set2" colorScheme="6" hideStateIcon>ML: {inv.mlModel}</Tag>
            </FlexBox>
            <Markdown text={inv.aiSummary} />
          </div>
          <Title level="H5" size="H5" className="sub-title">Risk findings ({inv.anomalies.length})</Title>
          {inv.anomalies.length === 0 && <MessageStrip design="Positive" hideCloseButton>No fraud or compliance signals detected.</MessageStrip>}
          <div className="findings">
            {inv.anomalies.map((a) => (
              <MessageStrip key={a.ID} design={SEV_DESIGN[a.severity]} hideCloseButton icon={<Icon name={SEVERITY_ICON[a.severity]} />}>
                <b>{a.title}</b> <span className="finding-meta">{a.severity} · {a.code} · {a.source}{Number(a.weight) ? ` · +${Number(a.weight)}` : ''}</span><br />{a.detail}
              </MessageStrip>
            ))}
          </div>
          {inv.decisionComment && <MessageStrip design="Information" hideCloseButton style={{ marginTop: '0.75rem' }}>Decision by <b>{inv.decisionBy}</b>: {inv.decisionComment}</MessageStrip>}
        </ObjectPageSection>

        <ObjectPageSection id="match" titleText="3-Way Match">
          <FlexBox wrap="Wrap" style={{ gap: '0.5rem', marginBottom: '0.75rem' }}>
            {header.map((h) => <ObjectStatus key={h.ID} state={LINE_STATE[h.status]} showDefaultIcon inverted>{h.description}: {h.message}</ObjectStatus>)}
          </FlexBox>
          <AnalyticalTable data={lines} columns={matchCols} visibleRows={Math.max(1, lines.length)} rowHeight={56} scaleWidthMode="Smart" noDataText="No lines" />
          <Text className="muted small">
            Invoice vs SAP purchase order (API_PURCHASEORDER_PROCESS_SRV) vs goods receipts (API_MATERIAL_DOCUMENT_SRV, mvt 101).
            Price tolerance {settings.pricePctWarn ?? 2}% warn / {settings.pricePctFail ?? 5}% block (current settings; this invoice was matched when it was received).
          </Text>
        </ObjectPageSection>

        <ObjectPageSection id="items" titleText="Invoice Data">
          <FlexBox wrap="Wrap" style={{ gap: '2rem', marginBottom: '1rem' }}>
            <Field label="Vendor">{inv.vendorName} {inv.vendor_ID ? `(SAP ${inv.vendor_ID})` : ''}</Field>
            <Field label="Vendor GSTIN">{inv.vendorGstin}</Field>
            <Field label="Bank account on invoice">{inv.bankAccount}</Field>
            <Field label="Bank account in SAP">{inv.vendor?.bankAccount}</Field>
            <Field label="Source">{inv.source} · {inv.fileName}</Field>
            <Field label="Received">{dateTime(inv.receivedAt)}</Field>
            <Field label="Processing time">{inv.processingMs} ms</Field>
          </FlexBox>
          {inv.vendor?.paymentBlocked && <MessageStrip design="Negative" hideCloseButton className="banner">Vendor is blocked for payment: {inv.vendor.blockReason}</MessageStrip>}
          <AnalyticalTable data={inv.items} columns={itemCols} visibleRows={Math.max(1, inv.items.length)} scaleWidthMode="Smart" />
        </ObjectPageSection>

        <ObjectPageSection id="discussion" titleText={`Discussion (${inv.comments.length})`}>
          <div className="thread">
            {inv.comments.length === 0 && <Text className="muted">No comments yet. Use the discussion to coordinate with buyers and approvers - it is part of the audit report.</Text>}
            {inv.comments.map((c) => (
              <div key={c.ID} className="thread-item">
                <Avatar initials={initials(c.authorName)} size="XS" colorScheme="Accent6" />
                <div>
                  <div className="thread-meta"><b>{c.authorName}</b> · {dateTime(c.createdAt)}</div>
                  <div className="thread-text">{c.text}</div>
                </div>
              </div>
            ))}
          </div>
          <FlexBox className="composer" alignItems="End" style={{ gap: '0.5rem' }}>
            <TextArea rows={2} maxlength={1000} value={note} placeholder="Add a comment for buyers and approvers" onInput={(e) => setNote(e.target.value)} />
            <Button design="Emphasized" icon="post" disabled={busy || !note.trim()} onClick={postNote}>Post</Button>
          </FlexBox>
        </ObjectPageSection>

        {can('Approver') && (
          <ObjectPageSection id="audit" titleText="Audit Trail">
            <Timeline>
              {audit.map((a) => (
                <TimelineItem key={a.ID} titleText={a.action} subtitleText={`${dateTime(a.createdAt)} · ${a.actor}`} icon={AUDIT_ICON[a.action] || 'log'}>
                  {a.detail}
                </TimelineItem>
              ))}
            </Timeline>
          </ObjectPageSection>
        )}
      </ObjectPage>

      <Dialog
        open={!!dialog}
        headerText={d ? `${d.title} ${inv.invoiceNumber}` : ''}
        onClose={() => setDialog(null)}
        footer={
          <Bar endContent={<>
            <Button design={d?.design} disabled={busy || (d?.required && !comment.trim())} onClick={submitDialog}>{d?.button}</Button>
            <Button design="Transparent" onClick={() => setDialog(null)}>Cancel</Button>
          </>} />
        }
      >
        {d && (
          <div style={{ width: 'min(420px, 80vw)' }}>
            {dialog === 'approve' && inv.status === 'Exception' && <MessageStrip design="Critical" hideCloseButton>This invoice has open exceptions. A justification is mandatory and will be written to the audit trail.</MessageStrip>}
            {dialog === 'delete' && (
              <MessageStrip design="Negative" hideCloseButton>
                This permanently removes the invoice with its lines, 3-way match, risk findings and comments. It cannot be undone.
                The audit trail keeps its history plus a record of this deletion, and the same document can be uploaded again.
              </MessageStrip>
            )}
            {dialog === 'hold' && (
              <>
                <MessageStrip design="Information" hideCloseButton>A held invoice cannot be approved until the hold is released. The {settings.slaDays ?? 5}-day SLA restarts now.</MessageStrip>
                <Label for="hold-cat" style={{ marginTop: '0.75rem', display: 'block' }}>Category</Label>
                <Select id="hold-cat" style={{ width: '100%' }} onChange={(e) => setCategory(e.detail.selectedOption.value)}>
                  {Object.entries(HOLD_CATEGORIES).map(([k, v]) => <Option key={k} value={k} selected={category === k}>{v}</Option>)}
                </Select>
              </>
            )}
            <ReasonField id="cmt" label={d.label} value={comment} onInput={setComment} placeholder={d.placeholder} />
          </div>
        )}
      </Dialog>
    </>
  );
}
