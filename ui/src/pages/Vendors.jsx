import { useEffect, useMemo, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Title, Text, Card, CardHeader, AnalyticalTable, ProgressIndicator, FlexBox, Label, Tag, List, ListItemStandard, BusyIndicator, Button,
  MessageStrip, Dialog, Bar, Input, CheckBox, Icon
} from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { ReasonField } from '../components/Common.jsx';
import { inr, date, dateTime } from '../format';

const tone = (s) => (s >= 45 ? 'Negative' : s >= 20 ? 'Critical' : 'Positive');
const REQ_DESIGN = { Pending: 'Critical', Approved: 'Positive', Rejected: 'Negative' };
const DIALOG = {
  block: { title: 'Block payments to', button: 'Block payments', design: 'Negative', label: 'Reason', placeholder: 'e.g. Bank details under verification after suspicious e-mail', ok: 'Vendor blocked for payment' },
  unblock: { title: 'Lift payment block for', button: 'Lift block', design: 'Emphasized', label: 'Reason', placeholder: 'e.g. Vendor verified by phone, cleared by internal audit', ok: 'Payment block lifted' },
  bank: { title: 'Request bank change for', button: 'Submit for approval', design: 'Emphasized', label: 'Reason', placeholder: 'e.g. Vendor letter dated 12 Oct, account moved to ICICI', ok: 'Bank change submitted for four-eyes approval' },
  approveBank: { title: 'Approve bank change for', button: 'Approve change', design: 'Positive', label: 'Comment (optional)', placeholder: 'e.g. Verified against cancelled cheque', ok: 'Bank details changed' },
  rejectBank: { title: 'Reject bank change for', button: 'Reject change', design: 'Negative', label: 'Reason', placeholder: 'e.g. Call-back number did not match vendor master', ok: 'Bank change rejected', required: true }
};

export default function Vendors() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, can, notify } = useApp();
  const [rows, setRows] = useState(null);
  const [selId, setSelId] = useState(params.get('id'));
  const [dialog, setDialog] = useState(null); // { kind, request? }
  const [text, setText] = useState('');
  const [account, setAccount] = useState('');
  const [callback, setCallback] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api.vendors().then((v) => { setRows(v); setSelId((id) => id || v[0]?.ID); }), []);
  useEffect(() => { load(); }, [load]);

  const data = useMemo(() => (rows || []).map((v) => {
    const live = v.invoices.filter((i) => i.status !== 'Rejected');
    return { ...v, count: v.invoices.length, spend: live.reduce((s, i) => s + Number(i.grossAmount), 0), open: v.invoices.filter((i) => ['Exception', 'OnHold'].includes(i.status)).length,
      pending: v.bankChanges.find((b) => b.status === 'Pending'), ageDays: Math.round((Date.now() - new Date(v.onboardedOn)) / 86400000) };
  }), [rows]);

  if (!rows) return <BusyIndicator active size="L" className="center-busy" />;

  const columns = [
    { Header: 'Vendor', accessor: 'name', minWidth: 230, Cell: ({ value, row }) => (
      <div className="cell-2">
        <FlexBox alignItems="Center" style={{ gap: '0.3rem', minWidth: 0 }}>
          <b className="ellipsis">{value}</b>
          {row.original.paymentBlocked && <Icon name="locked" className="vendor-flag flag-blocked" accessibleName="Payments blocked" showTooltip />}
          {row.original.pending && <Icon name="edit" className="vendor-flag flag-pending" accessibleName="Bank change waiting for approval" showTooltip />}
        </FlexBox>
        <span>SAP {row.original.ID} · {row.original.category} · {row.original.city}</span>
      </div>
    ) },
    { Header: 'Invoices', accessor: 'count', width: 80, hAlign: 'End' },
    { Header: 'Spend', accessor: 'spend', width: 140, hAlign: 'End', Cell: ({ value }) => inr(value) },
    { Header: 'Open', accessor: 'open', width: 70, hAlign: 'End' },
    { Header: 'Vendor risk', accessor: 'riskScore', width: 180, Cell: ({ value }) => <ProgressIndicator value={Math.round(Number(value))} valueState={tone(Number(value))} displayValue={`${Math.round(Number(value))} / 100`} style={{ width: '100%' }} /> }
  ];

  const s = data.find((v) => v.ID === selId);
  const pendingAll = data.filter((v) => v.pending);
  const d = dialog && DIALOG[dialog.kind];
  const open = (kind, request) => { setDialog({ kind, request }); setText(''); setAccount(''); setCallback(false); };
  const submit = async () => {
    setBusy(true);
    try {
      const { kind, request } = dialog;
      if (kind === 'block') await api.blockVendor(s.ID, text);
      if (kind === 'unblock') await api.unblockVendor(s.ID, text);
      if (kind === 'bank') await api.requestBankChange(s.ID, { newAccount: account.trim().toUpperCase(), reason: text, callbackConfirmed: callback });
      if (kind === 'approveBank') await api.approveBankChange(request.ID, text);
      if (kind === 'rejectBank') await api.rejectBankChange(request.ID, text);
      notify(d.ok); setDialog(null); load();
    } catch (e) { notify(e.message); }
    finally { setBusy(false); }
  };
  const canSubmit = !busy && (dialog?.kind === 'bank' ? account.trim() && text.trim() && callback : !(['block', 'unblock'].includes(dialog?.kind) || d?.required) || text.trim());

  return (
    <div className="page">
      <Title level="H2" size="H3">Vendor Risk</Title>
      <Text className="muted">Supplier master replicated from SAP S/4HANA (A_Supplier) with a rolling risk score from ProcureIQ findings, payment blocks and dual-control bank changes</Text>
      {can('Manager') && pendingAll.length > 0 && (
        <MessageStrip design="Critical" hideCloseButton style={{ marginTop: '1rem' }}>
          <b>{pendingAll.length} bank change(s) waiting for four-eyes approval:</b>{' '}
          {pendingAll.map((v, i) => <span key={v.ID}>{i > 0 && ', '}<a href="#" className="inline-link" onClick={(e) => { e.preventDefault(); setSelId(v.ID); }}>{v.name}</a></span>)}
        </MessageStrip>
      )}
      <div className="grid-main-side" style={{ marginTop: '1rem' }}>
        <Card>
          <AnalyticalTable data={data} columns={columns} sortable rowHeight={56} visibleRows={10} scaleWidthMode="Smart" selectionMode="Single" selectionBehavior="RowOnly"
            onRowSelect={(e) => setSelId(e.detail.row.original.ID)} />
        </Card>
        {s && (
          <Card header={<CardHeader titleText={s.name} subtitleText={`SAP supplier ${s.ID} · ${s.category}`} />}>
            <div className="side-card">
              {s.paymentBlocked && (
                <MessageStrip design="Negative" hideCloseButton icon={<Icon name="locked" />} className="banner">
                  <b>Payments blocked</b> by {s.blockedBy} on {dateTime(s.blockedAt)}: {s.blockReason}
                </MessageStrip>
              )}
              <FlexBox wrap="Wrap" style={{ gap: '1rem 2rem' }}>
                <div className="field"><Label>GSTIN</Label><div>{s.gstin}</div></div>
                <div className="field"><Label>Payment terms</Label><div>{s.paymentTerms}</div></div>
                <div className="field"><Label>Onboarded</Label><div>{date(s.onboardedOn)} {s.ageDays < 90 && <Tag design="Critical">New vendor</Tag>}</div></div>
                <div className="field"><Label>Bank account (master)</Label><div className="mono">{s.bankAccount}</div></div>
              </FlexBox>

              <FlexBox wrap="Wrap" style={{ gap: '0.5rem', margin: '1rem 0 0.5rem' }}>
                {!s.paymentBlocked && can('Approver') && <Button design="Negative" icon="locked" onClick={() => open('block')}>Block payments</Button>}
                {s.paymentBlocked && can('Manager') && <Button icon="unlocked" onClick={() => open('unblock')}>Lift payment block</Button>}
                {!s.pending && <Button icon="edit" onClick={() => open('bank')}>Request bank change</Button>}
              </FlexBox>

              {s.bankChanges.length > 0 && (
                <>
                  <Label style={{ display: 'block', marginTop: '1rem' }}>Bank master changes (dual control)</Label>
                  <div className="bank-changes">
                    {s.bankChanges.map((b) => (
                      <div key={b.ID} className="bank-change">
                        <FlexBox justifyContent="SpaceBetween" alignItems="Center" style={{ gap: '0.5rem' }}>
                          <span className="mono">{b.oldAccount} → {b.newAccount}</span>
                          <Tag design={REQ_DESIGN[b.status]} hideStateIcon>{b.status}</Tag>
                        </FlexBox>
                        <Text className="muted small">
                          Requested by {b.requestedBy} on {dateTime(b.createdAt)}: {b.reason}
                          {b.decidedBy && ` · ${b.status.toLowerCase()} by ${b.decidedBy}${b.decisionComment ? `: ${b.decisionComment}` : ''}`}
                        </Text>
                        {b.status === 'Pending' && can('Manager') && (
                          b.requestedBy === user.user
                            ? <Text className="small text-warn">Four-eyes principle: another Finance Manager must decide your own request.</Text>
                            : <FlexBox style={{ gap: '0.5rem', marginTop: '0.25rem' }}>
                                <Button design="Positive" icon="accept" onClick={() => open('approveBank', b)}>Approve</Button>
                                <Button design="Negative" icon="decline" onClick={() => open('rejectBank', b)}>Reject</Button>
                              </FlexBox>
                        )}
                      </div>
                    ))}
                  </div>
                </>
              )}

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

      <Dialog
        open={!!dialog}
        headerText={d && s ? `${d.title} ${s.name}` : ''}
        onClose={() => setDialog(null)}
        footer={<Bar endContent={<>
          <Button design={d?.design} disabled={!canSubmit} onClick={submit}>{d?.button}</Button>
          <Button design="Transparent" onClick={() => setDialog(null)}>Cancel</Button>
        </>} />}
      >
        {d && (
          <div style={{ width: 'min(440px, 80vw)' }}>
            {dialog.kind === 'block' && <MessageStrip design="Information" hideCloseButton>Open invoices of this vendor are excluded from payment runs and new invoices are flagged as Critical. Only a Finance Manager can lift the block.</MessageStrip>}
            {dialog.kind === 'bank' && (
              <>
                <MessageStrip design="Critical" hideCloseButton>Bank changes are the #1 vendor-impersonation pattern. The change takes effect only after a different Finance Manager approves it (four-eyes).</MessageStrip>
                <Label style={{ marginTop: '0.75rem', display: 'block' }}>Current account</Label>
                <div className="mono">{s.bankAccount}</div>
                <Label for="new-acct" required style={{ marginTop: '0.75rem', display: 'block' }}>New account (IFSC-account number)</Label>
                <Input id="new-acct" value={account} placeholder="e.g. ICIC0004410-441005001234" onInput={(e) => setAccount(e.target.value)} style={{ width: '100%' }} />
              </>
            )}
            {['approveBank', 'rejectBank'].includes(dialog.kind) && (
              <div className="bank-change" style={{ marginBottom: '0.5rem' }}>
                <span className="mono">{dialog.request.oldAccount} → {dialog.request.newAccount}</span>
                <Text className="muted small">Requested by {dialog.request.requestedBy}: {dialog.request.reason} · vendor call-back confirmed</Text>
              </div>
            )}
            <ReasonField id="vendor-text" label={d.label} value={text} onInput={setText} placeholder={d.placeholder} rows={3} />
            {dialog.kind === 'bank' && (
              <CheckBox checked={callback} onChange={(e) => setCallback(e.target.checked)} wrappingType="Normal" style={{ marginTop: '0.5rem' }}
                text="I called the vendor back on the phone number stored in the vendor master (never the number on the request) and they confirmed the change." />
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
