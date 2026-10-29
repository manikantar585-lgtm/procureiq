import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Title, Text, Card, CardHeader, FlexBox, Button, Icon, MessageStrip, List, ListItemStandard, FileUploader } from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';

const STEPS = [
  { icon: 'pdf-attachment', title: 'Document AI', text: 'Read PDF, extract header, GSTIN, bank & line items' },
  { icon: 'supplier', title: 'Vendor master', text: 'Resolve supplier in SAP (A_Supplier) by GSTIN / name' },
  { icon: 'sales-order', title: 'SAP PO & GR', text: 'Fetch purchase order and goods receipts from S/4HANA' },
  { icon: 'inspection', title: '3-way match', text: 'Compare price & quantity with tolerance keys' },
  { icon: 'shield', title: 'Risk engine', text: '14 fraud rules + ML ensemble anomaly score' },
  { icon: 'ai', title: 'AI reviewer', text: 'Write recommendation & route the invoice' }
];

const SAMPLES = [
  ['01-clean-bharat-steel.pdf', 'Clean 3-way match', 'Positive'],
  ['02-price-variance-sri-lakshmi.pdf', 'Unit price 9% above PO', 'Critical'],
  ['03-bank-fraud-godavari.pdf', 'Bank account ≠ vendor master', 'Negative'],
  ['04-over-billing-deccan.pdf', 'Billed more than received', 'Negative'],
  ['05-clean-vertex-safety.pdf', 'Clean 3-way match', 'Positive']
];

const toBase64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(blob); });

export default function Upload() {
  const navigate = useNavigate();
  const { notify } = useApp();
  const [step, setStep] = useState(-1);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [drag, setDrag] = useState(false);
  const timer = useRef(null);
  useEffect(() => () => clearInterval(timer.current), []);

  const processFile = async (name, blob) => {
    setError(null);
    setStep(0);
    clearInterval(timer.current);
    timer.current = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 350);
    try {
      const b64 = await toBase64(blob);
      const r = await api.upload(name, b64);
      clearInterval(timer.current);
      setStep(STEPS.length);
      setResults((x) => [{ ...r, fileName: name }, ...x]);
      notify(`${r.invoiceNumber} processed in ${r.processingMs} ms → ${r.status}`);
    } catch (e) {
      clearInterval(timer.current);
      setStep(-1);
      setError(e.message);
    }
  };

  const onFiles = (files) => { const f = files?.[0]; if (f) processFile(f.name, f); };
  const trySample = async (file) => { const blob = await (await fetch(`/samples/${file}`)).blob(); processFile(file, blob); };

  return (
    <div className="page">
      <Title level="H2" size="H3">Capture Invoice</Title>
      <Text className="muted">Upload a supplier invoice (PDF). ProcureIQ runs the full AI pipeline against SAP S/4HANA in about a second.</Text>

      <div className="grid-2" style={{ marginTop: '1rem' }}>
        <Card header={<CardHeader titleText="Upload document" subtitleText="PDF or text · max 10 MB" />}>
          <div
            className={`dropzone ${drag ? 'drag' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
          >
            <Icon name="upload-to-cloud" className="drop-icon" />
            <Title level="H5" size="H5">Drop invoice here</Title>
            <Text className="muted">or</Text>
            <FileUploader accept=".pdf,.txt" hideInput onChange={(e) => onFiles(e.detail.files)}>
              <Button design="Emphasized" icon="pdf-attachment">Browse files</Button>
            </FileUploader>
          </div>
          {error && <MessageStrip design="Negative" style={{ margin: '0 1rem 1rem' }} onClose={() => setError(null)}>{error}</MessageStrip>}
          <div className="samples">
            <Text className="muted small">No invoice at hand? Try a sample:</Text>
            <FlexBox wrap="Wrap" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
              {SAMPLES.map(([f, label, design]) => (
                <Button key={f} design="Default" icon={design === 'Positive' ? 'message-success' : 'message-warning'} onClick={() => trySample(f)} tooltip={f}>{label}</Button>
              ))}
            </FlexBox>
          </div>
        </Card>

        <Card header={<CardHeader titleText="AI pipeline" subtitleText="Live processing steps" />}>
          <ol className="pipeline">
            {STEPS.map((s, i) => (
              <li key={s.title} className={step > i ? 'done' : step === i ? 'active' : ''}>
                <span className="pipe-icon"><Icon name={step > i ? 'accept' : s.icon} /></span>
                <div><b>{s.title}</b><span>{s.text}</span></div>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {results.length > 0 && (
        <Card header={<CardHeader titleText="Processed in this session" />} style={{ marginTop: '1rem' }}>
          <List>
            {results.map((r) => (
              <ListItemStandard key={r.ID} icon="pdf-attachment" description={`${r.fileName} · ${r.processingMs} ms`} onClick={() => navigate(`/invoices/${r.ID}`)}
                additionalText={r.status} additionalTextState={r.status === 'Matched' ? 'Positive' : 'Critical'}>
                {r.invoiceNumber} — risk {r.riskLevel}
              </ListItemStandard>
            ))}
          </List>
        </Card>
      )}
    </div>
  );
}
