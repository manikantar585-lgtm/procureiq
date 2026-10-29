import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Title, Text, Card, AnalyticalTable, Tag, FlexBox, Button } from '@ui5/webcomponents-react';
import { api } from '../api';
import { dateTime } from '../format';
import { downloadCsv, stamp } from '../download';

const DESIGN = {
  APPROVED: 'Positive', POSTED: 'Positive', REJECTED: 'Negative', POST_FAILED: 'Negative', SCORED: 'Information', EXTRACTED: 'Information', MATCHED: 'Information', ROUTED: 'Neutral', RECEIVED: 'Neutral',
  ON_HOLD: 'Critical', RELEASED: 'Information', ESCALATED: 'Negative', PAID: 'Positive', PAYMENT_RUN: 'Positive', PAYMENT_BLOCK: 'Negative', PAYMENT_UNBLOCK: 'Information',
  BANK_CHANGE_REQUESTED: 'Critical', BANK_CHANGED: 'Positive', BANK_CHANGE_REJECTED: 'Negative', SETTING_CHANGED: 'Information',
  DELETED: 'Negative', DATA_RESET: 'Critical'
};
const objectOf = (r) => r.invoice?.invoiceNumber || (r.invoice_ID ? 'Deleted invoice' : r.vendor ? `Vendor ${r.vendor.name}` : 'System');

export default function Audit() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.audit().then(setRows).finally(() => setLoading(false)); }, []);

  return (
    <div className="page">
      <FlexBox justifyContent="SpaceBetween" alignItems="Center" wrap="Wrap" style={{ gap: '1rem' }}>
        <div>
          <Title level="H2" size="H3">Audit Trail</Title>
          <Text className="muted">Immutable log of every AI pipeline step, human decision, payment and master-data change (SOX / internal-control evidence)</Text>
        </div>
        <Button icon="excel-attachment" design="Transparent" disabled={!rows.length}
          onClick={() => downloadCsv(`procureiq-audit-${stamp()}.csv`, [['Timestamp', (r) => r.createdAt], ['Object', objectOf], ['Action', (r) => r.action], ['Actor', (r) => r.actor], ['Detail', (r) => r.detail]], rows)}>Export CSV</Button>
      </FlexBox>
      <Card style={{ marginTop: '1rem' }}>
        <AnalyticalTable
          loading={loading}
          data={rows}
          filterable
          sortable
          visibleRows={16}
          scaleWidthMode="Smart"
          onRowClick={(e) => { const r = e.detail.row.original; if (r.invoice) navigate(`/invoices/${r.invoice_ID}`); else if (r.vendor_ID) navigate(`/vendors?id=${r.vendor_ID}`); }}
          columns={[
            { Header: 'Timestamp', accessor: 'createdAt', width: 150, Cell: ({ value }) => dateTime(value) },
            { Header: 'Object', id: 'object', accessor: objectOf, width: 200 },
            { Header: 'Action', accessor: 'action', width: 190, Cell: ({ value }) => <Tag design={DESIGN[value] || 'Neutral'} hideStateIcon>{value}</Tag> },
            { Header: 'Actor', accessor: 'actor', width: 100 },
            { Header: 'Detail', accessor: 'detail', minWidth: 300 }
          ]}
        />
      </Card>
    </div>
  );
}
