import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ObjectPage, ObjectPageTitle, ObjectPageHeader, ObjectPageSection, Title, Text, Label, FlexBox, Button, Toolbar, ToolbarButton,
  BusyIndicator, MessageStrip, AnalyticalTable, ObjectStatus, Dialog, TextArea, Bar, Timeline, TimelineItem, Icon, Breadcrumbs, BreadcrumbsItem, Tag, Link
} from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { Markdown, RiskTag, StatusTag, MatchStatus, RiskGauge } from '../components/Common.jsx';
import { inr, date, dateTime, LINE_STATE, SEVERITY_ICON } from '../format';

const SEV_DESIGN = { Low: 'Information', Medium: 'Critical', High: 'Negative', Critical: 'Negative' };
const AUDIT_ICON = { RECEIVED: 'pdf-attachment', EXTRACTED: 'ai', MATCHED: 'inspection', SCORED: 'shield', ROUTED: 'process', APPROVED: 'accept', REJECTED: 'decline', POSTED: 'paper-plane', POST_FAILED: 'error' };

function Field({ label, children }) {
  return (<div className="field"><Label>{label}</Label><div className="field-value">{children ?? '–'}</div></div>);
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { can, notify } = useApp();
  const [inv, setInv] = useState(null);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState(null);
  const [dialog, setDialog] = useState(null); // 'approve' | 'reject'
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.invoice(id).then(setInv).catch((e) => setError(e.message));
    if (can('Approver')) api.audit(id).then((a) => setAudit([...a].reverse())).catch(() => {});
  }, [id, can]);
  useEffect(load, [load]);

  const act = async (fn, okMsg) => {
    setBusy(true);
    try { await fn(); notify(okMsg); setDialog(null); setComment(''); load(); }
    catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };

  if (error) return <div className="page"><MessageStrip design="Negative">{error}</MessageStrip></div>;
  if (!inv) return <BusyIndicator active size="L" className="center-busy" />;

  const header = inv.matchResults.filter((m) => m.lineNo === 0);
  const lines = inv.matchResults.filter((m) => m.lineNo > 0);
  const decidable = ['Matched', 'Exception'].includes(inv.status);
  const rec = /Recommendation:\s*\**\s*(APPROVE|REVIEW|BLOCK)/i.exec(inv.aiSummary || '')?.[1]?.toUpperCase();

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
            subHeader={<FlexBox style={{ gap: '0.5rem' }} alignItems="Center"><Text>{inv.vendorName}</Text><StatusTag status={inv.status} /><RiskTag level={inv.riskLevel} score={inv.riskScore} /></FlexBox>}
            actionsBar={
              <Toolbar design="Transparent">
                {decidable && can('Approver') && <ToolbarButton design="Positive" icon="accept" text="Approve" onClick={() => setDialog('approve')} />}
                {inv.status !== 'Posted' && inv.status !== 'Rejected' && can('Approver') && <ToolbarButton design="Negative" icon="decline" text="Reject" onClick={() => setDialog('reject')} />}
                {inv.status === 'Approved' && can('Approver') && <ToolbarButton design="Emphasized" icon="paper-plane" text="Post to SAP" disabled={busy} onClick={() => act(() => api.post(inv.ID), 'Supplier invoice posted to SAP S/4HANA')} />}
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
            </FlexBox>
          </ObjectPageHeader>
        }
      >
        <ObjectPageSection id="review" titleText="AI Review">
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
          <Text className="muted small">Invoice vs SAP purchase order (API_PURCHASEORDER_PROCESS_SRV) vs goods receipts (API_MATERIAL_DOCUMENT_SRV, mvt 101). Price tolerance 2% warn / 5% block.</Text>
        </ObjectPageSection>

        <ObjectPageSection id="items" titleText="Invoice Data">
          <FlexBox wrap="Wrap" style={{ gap: '2rem', marginBottom: '1rem' }}>
            <Field label="Vendor">{inv.vendorName} {inv.vendor_ID ? `(SAP ${inv.vendor_ID})` : ''}</Field>
            <Field label="Vendor GSTIN">{inv.vendorGstin}</Field>
            <Field label="Bank account on invoice">{inv.bankAccount}</Field>
            <Field label="Bank account in SAP">{inv.vendor?.bankAccount}</Field>
            <Field label="Source">{inv.source} · {inv.fileName}</Field>
            <Field label="Processing time">{inv.processingMs} ms</Field>
          </FlexBox>
          <AnalyticalTable data={inv.items} columns={itemCols} visibleRows={Math.max(1, inv.items.length)} scaleWidthMode="Smart" />
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
        headerText={dialog === 'approve' ? `Approve ${inv.invoiceNumber}` : `Reject ${inv.invoiceNumber}`}
        onClose={() => setDialog(null)}
        footer={
          <Bar endContent={<>
            <Button design={dialog === 'approve' ? 'Positive' : 'Negative'} disabled={busy}
              onClick={() => act(() => (dialog === 'approve' ? api.approve(inv.ID, comment) : api.reject(inv.ID, comment)), dialog === 'approve' ? 'Invoice approved' : 'Invoice rejected')}>
              {dialog === 'approve' ? 'Approve' : 'Reject'}
            </Button>
            <Button design="Transparent" onClick={() => setDialog(null)}>Cancel</Button>
          </>} />
        }
      >
        <div style={{ width: 'min(420px, 80vw)' }}>
          {dialog === 'approve' && inv.status === 'Exception' && <MessageStrip design="Critical" hideCloseButton>This invoice has open exceptions. A justification is mandatory and will be written to the audit trail.</MessageStrip>}
          <Label for="cmt" style={{ marginTop: '0.75rem', display: 'block' }}>{dialog === 'approve' ? 'Comment' : 'Reason (sent to vendor)'}</Label>
          <TextArea id="cmt" rows={4} value={comment} onInput={(e) => setComment(e.target.value)} style={{ width: '100%' }}
            placeholder={dialog === 'approve' ? 'e.g. Price increase confirmed by buyer, PO amendment 2 pending' : 'e.g. Billed quantity exceeds goods received - please issue credit note'} />
        </div>
      </Dialog>
    </>
  );
}
