import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Title, Text, FlexBox, Button, TextArea, Avatar, Icon, Tag, Panel, Link, BusyIndicator } from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { Markdown } from '../components/Common.jsx';

const SUGGESTIONS = [
  'Which invoices are high risk right now?',
  'Do we have any duplicate invoices?',
  'Any bank account fraud or split invoicing?',
  'What does our policy say about price tolerance?',
  'Show PO 4500000117 from SAP',
  'Tell me about vendor Apex Industrial Tools',
  'Top vendors by spend',
  'What is pending approval?'
];

export default function Copilot() {
  const { user, status } = useApp();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);
  const asked = useRef(false);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  const ask = async (question) => {
    const q = question.trim();
    if (!q || busy) return;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: 'user', content: q }]);
    setInput('');
    setBusy(true);
    const t0 = performance.now();
    try {
      const r = await api.ask(q, history);
      setMessages((m) => [...m, { role: 'assistant', content: r.answer, toolCalls: r.toolCalls, sources: r.sources, engine: r.engine, ms: Math.round(performance.now() - t0) }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠️ ${e.message}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const q = params.get('q');
    if (q && !asked.current) { asked.current = true; setParams({}); ask(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openSource = async (s) => {
    if (s.kind === 'invoice') navigate(`/invoices/${s.ref}`);
    else if (s.kind === 'sap') navigate(`/sap?po=${s.ref}`);
    else if (s.kind === 'invoice-number') {
      const r = await api.invoices({ $filter: `invoiceNumber eq '${s.ref}'`, $top: 1 });
      if (r[0]) navigate(`/invoices/${r[0].ID}`);
    }
  };

  return (
    <div className="page copilot">
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" wrap="Wrap" style={{ gap: '0.5rem' }}>
        <div>
          <Title level="H2" size="H3">ProcureIQ Copilot</Title>
          <Text className="muted">Agentic assistant with tools over SAP S/4HANA, the invoice ledger and AP policy (RAG)</Text>
        </div>
        <Tag design={status?.llmProvider === 'offline' ? 'Neutral' : 'Positive'} icon="ai">{status?.llmProvider === 'offline' ? 'Offline intent router · set an LLM key for full agent' : `LLM agent · ${status?.llmModel}`}</Tag>
      </FlexBox>

      <div className="chat">
        {messages.length === 0 && (
          <div className="chat-empty">
            <Icon name="ai" className="chat-empty-icon" />
            <Title level="H4" size="H4">How can I help, {user.name.split(' ')[0]}?</Title>
            <Text className="muted">I can search invoices, explain blocks, look up SAP purchase orders, analyse vendors and quote company policy.</Text>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => ask(s)}>{s}</button>)}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            {m.role === 'assistant' ? <Avatar icon="ai" size="XS" colorScheme="Accent6" /> : <Avatar initials={user.initials} size="XS" colorScheme="Accent1" />}
            <div className="bubble">
              {m.role === 'assistant' ? <Markdown text={m.content} /> : <Text>{m.content}</Text>}
              {m.role === 'assistant' && !m.error && (
                <>
                  {m.sources?.length > 0 && (
                    <FlexBox wrap="Wrap" style={{ gap: '0.25rem 0.75rem', marginTop: '0.5rem' }}>
                      <Text className="muted small">Sources:</Text>
                      {m.sources.map((s) => s.kind === 'policy'
                        ? <Text key={s.ref} className="small source-policy">📘 {s.title}</Text>
                        : <Link key={s.ref} className="small" onClick={() => openSource(s)}>{s.title}</Link>)}
                    </FlexBox>
                  )}
                  {m.toolCalls?.length > 0 && (
                    <Panel collapsed headerText={`Agent trace · ${m.toolCalls.length} tool call(s) · ${m.engine} · ${m.ms} ms`} className="trace" fixed={false}>
                      {m.toolCalls.map((t, j) => <code key={j} className="trace-line">{j + 1}. {t}</code>)}
                    </Panel>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {busy && <div className="msg msg-assistant"><Avatar icon="ai" size="XS" colorScheme="Accent6" /><div className="bubble"><BusyIndicator active size="S" /> <Text className="muted">Thinking · calling tools…</Text></div></div>}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <TextArea
          value={input}
          rows={2}
          growing
          growingMaxRows={6}
          placeholder="Ask about invoices, vendors, SAP POs or policy…  (Enter to send, Shift+Enter for a new line)"
          onInput={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); } }}
        />
        <Button design="Emphasized" icon="paper-plane" disabled={busy || !input.trim()} onClick={() => ask(input)}>Send</Button>
      </div>
    </div>
  );
}
