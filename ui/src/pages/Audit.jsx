import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Title, Text, Card, AnalyticalTable, Tag } from '@ui5/webcomponents-react';
import { api } from '../api';
import { dateTime } from '../format';

const DESIGN = { APPROVED: 'Positive', POSTED: 'Positive', REJECTED: 'Negative', POST_FAILED: 'Negative', SCORED: 'Information', EXTRACTED: 'Information', MATCHED: 'Information', ROUTED: 'Neutral', RECEIVED: 'Neutral' };

export default function Audit() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => { api.audit().then(setRows).finally(() => setLoading(false)); }, []);

  return (
    <div className="page">
      <Title level="H2" size="H3">Audit Trail</Title>
      <Text className="muted">Immutable log of every AI pipeline step and human decision (SOX / internal-control evidence)</Text>
      <Card style={{ marginTop: '1rem' }}>
        <AnalyticalTable
          loading={loading}
          data={rows}
          filterable
          sortable
          visibleRows={16}
          scaleWidthMode="Smart"
          onRowClick={(e) => e.detail.row.original.invoice_ID && navigate(`/invoices/${e.detail.row.original.invoice_ID}`)}
          columns={[
            { Header: 'Timestamp', accessor: 'createdAt', width: 150, Cell: ({ value }) => dateTime(value) },
            { Header: 'Invoice', accessor: 'invoice.invoiceNumber', width: 160 },
            { Header: 'Action', accessor: 'action', width: 130, Cell: ({ value }) => <Tag design={DESIGN[value] || 'Neutral'} hideStateIcon>{value}</Tag> },
            { Header: 'Actor', accessor: 'actor', width: 100 },
            { Header: 'Detail', accessor: 'detail', minWidth: 300 }
          ]}
        />
      </Card>
    </div>
  );
}
