import { Title, Text, Avatar, Icon, FlexBox, Tag } from '@ui5/webcomponents-react';
import { PERSONAS } from '../api';

const DESC = {
  clerk: 'Captures invoices, reviews AI extraction and asks the Copilot.',
  approver: 'Approves or rejects invoices within limit and posts them to SAP S/4HANA.',
  manager: 'Full control: releases high-value & critical invoices, sees the audit trail.'
};

export default function Login({ onLogin }) {
  return (
    <div className="login">
      <div className="login-hero">
        <FlexBox alignItems="Center" style={{ gap: '0.75rem' }}>
          <img src="/ui/logo.svg" alt="" width="48" height="48" />
          <div>
            <Title level="H2" size="H2" className="login-brand">ProcureIQ</Title>
            <Text className="login-tag">Agentic AI for SAP S/4HANA Procure-to-Pay</Text>
          </div>
        </FlexBox>
        <h1 className="login-headline">Touchless invoice processing,<br />with fraud caught before payment.</h1>
        <ul className="login-points">
          <li><Icon name="pdf-attachment" /> GenAI reads any supplier invoice in seconds</li>
          <li><Icon name="inspection" /> Live 3-way match against SAP purchase orders & goods receipts</li>
          <li><Icon name="shield" /> ML + rule engine flags duplicates, bank-account fraud & split invoices</li>
          <li><Icon name="ai" /> Copilot answers AP questions with tools over SAP data and policy</li>
        </ul>
        <FlexBox style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
          {['SAP CAP', 'OData V4', 'S/4HANA APIs', 'SAP BTP', 'UI5 Web Components', 'LLM Agents', 'scikit-learn'].map((t) => <Tag key={t} design="Set2" colorScheme="6" hideStateIcon>{t}</Tag>)}
        </FlexBox>
      </div>
      <div className="login-panel">
        <Title level="H4" size="H4">Sign in as</Title>
        <Text className="muted">Demo personas with SAP-style role collections (Clerk · Approver · Manager)</Text>
        <div className="persona-list">
          {Object.entries(PERSONAS).map(([k, p]) => (
            <button key={k} className="persona" onClick={() => onLogin(k)}>
              <Avatar initials={p.initials} size="S" colorScheme={k === 'clerk' ? 'Accent1' : k === 'approver' ? 'Accent6' : 'Accent8'} />
              <div className="persona-text">
                <b>{p.name}</b>
                <span className="persona-role">{p.role}</span>
                <span className="persona-desc">{DESC[k]}</span>
              </div>
              <Icon name="navigation-right-arrow" />
            </button>
          ))}
        </div>
        <Text className="muted small">Fictional company & data for demonstration. Production uses SAP BTP XSUAA / IAS single sign-on.</Text>
      </div>
    </div>
  );
}
