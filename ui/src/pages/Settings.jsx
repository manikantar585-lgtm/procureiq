import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Title, Text, Card, CardHeader, FlexBox, StepInput, Button, Label, MessageStrip, BusyIndicator, Dialog, Bar } from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { dateTime } from '../format';

const STEP = { INR: 50000, '%': 0.5, days: 1 };
const ORDER = ['approvalLimit', 'pricePctWarn', 'pricePctFail', 'slaDays', 'paymentHorizonDays'];
const byOrder = (a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name);

export default function Settings() {
  const navigate = useNavigate();
  const { notify, reloadSettings, status } = useApp();
  const [rows, setRows] = useState(null);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = () => api.settings().then((r) => { setRows([...r].sort(byOrder)); setDraft(Object.fromEntries(r.map((s) => [s.name, Number(s.value)]))); });
  useEffect(() => { load(); }, []);

  const save = async (s) => {
    setBusy(s.name);
    try { await api.updateSetting(s.name, draft[s.name]); notify(`${s.label} updated`); await load(); reloadSettings(); }
    catch (e) { notify(e.message); }
    finally { setBusy(null); }
  };
  const slaCheck = async () => {
    setBusy('sla');
    try { const n = await api.slaCheck(); notify(n ? `${n} invoice(s) escalated to the Finance Manager` : 'No new SLA breaches'); }
    catch (e) { notify(e.message); }
    finally { setBusy(null); }
  };

  const reset = async () => {
    setBusy('reset');
    try {
      const n = await api.resetData();
      notify(`All data deleted - ${n} demo invoices reloaded`);
      setConfirmReset(false); reloadSettings(); navigate('/overview');
    } catch (e) { notify(e.message); }
    finally { setBusy(null); }
  };

  if (!rows) return <BusyIndicator active size="L" className="center-busy" />;

  return (
    <div className="page">
      <Title level="H2" size="H3">Settings</Title>
      <Text className="muted">Business rules used by the AI pipeline and the approval workflow · Finance Manager only · every change is written to the audit trail</Text>
      <MessageStrip design="Information" hideCloseButton style={{ margin: '1rem 0' }}>
        Changes apply to invoices processed from now on. Invoices already processed keep the match and risk results they were scored with, so past decisions stay reproducible.
      </MessageStrip>
      <Card header={<CardHeader titleText="Business rules" subtitleText="Approval matrix, 3-way match tolerances (SAP tolerance keys PP), SLA and payment run" />}>
        <div className="settings-list">
          {rows.map((s) => {
            const changed = draft[s.name] !== Number(s.value);
            return (
              <div key={s.name} className="setting-row">
                <div>
                  <Label for={`set-${s.name}`}>{s.label}</Label>
                  <Text className="muted small">{s.modifiedBy && s.modifiedBy !== 'anonymous' ? `Last changed by ${s.modifiedBy} · ${dateTime(s.modifiedAt)}` : 'Default value'} · allowed {Number(s.minValue).toLocaleString('en-IN')}–{Number(s.maxValue).toLocaleString('en-IN')} {s.unit}</Text>
                </div>
                <FlexBox alignItems="Center" style={{ gap: '0.5rem' }}>
                  <StepInput id={`set-${s.name}`} value={draft[s.name]} min={Number(s.minValue)} max={Number(s.maxValue)} step={STEP[s.unit] || 1} valuePrecision={s.unit === '%' ? 1 : 0}
                    onChange={(e) => setDraft((d) => ({ ...d, [s.name]: Number(e.target.value) }))} style={{ width: 200 }} />
                  <Text className="unit">{s.unit}</Text>
                  <Button design="Emphasized" icon="save" disabled={!changed || busy === s.name} onClick={() => save(s)}>Save</Button>
                </FlexBox>
              </div>
            );
          })}
        </div>
      </Card>
      <Card header={<CardHeader titleText="SLA monitor" subtitleText="Runs automatically every hour; escalates exceptions and holds past the SLA" />} style={{ marginTop: '1rem' }}>
        <FlexBox className="side-card" alignItems="Center" justifyContent="SpaceBetween" wrap="Wrap" style={{ gap: '1rem' }}>
          <Text>Open exceptions older than the SLA are flagged in the inbox and on the Overview, with an audit-trail entry.</Text>
          <Button icon="lateness" disabled={busy === 'sla'} onClick={slaCheck}>Run SLA check now</Button>
        </FlexBox>
      </Card>
      <Card header={<CardHeader titleText="Data" subtitleText={`Stored in: ${status?.database || '…'}`} />} style={{ marginTop: '1rem' }}>
        <FlexBox className="side-card" alignItems="Center" justifyContent="SpaceBetween" wrap="Wrap" style={{ gap: '1rem' }}>
          <Text>Permanently delete every invoice, payment run, vendor change, comment, setting and audit entry, then reload the 28 demo invoices. To remove a single invoice, use Delete on the invoice page.</Text>
          <Button design="Negative" icon="delete" disabled={busy === 'reset'} onClick={() => setConfirmReset(true)}>Reset all data</Button>
        </FlexBox>
      </Card>

      <Dialog open={confirmReset} headerText="Reset all data?" onClose={() => setConfirmReset(false)}
        footer={<Bar endContent={<>
          <Button design="Negative" disabled={busy === 'reset'} onClick={reset}>{busy === 'reset' ? 'Resetting…' : 'Delete everything'}</Button>
          <Button design="Transparent" onClick={() => setConfirmReset(false)}>Cancel</Button>
        </>} />}>
        <div style={{ width: 'min(420px, 80vw)' }}>
          <MessageStrip design="Negative" hideCloseButton>
            This permanently deletes all ProcureIQ data, including the audit trail, and cannot be undone. The demo invoices are then replayed through the AI pipeline (a few seconds).
          </MessageStrip>
        </div>
      </Dialog>
    </div>
  );
}
