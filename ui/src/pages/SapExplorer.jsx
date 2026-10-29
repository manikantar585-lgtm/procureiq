import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Title, Text, Card, CardHeader, Input, Button, FlexBox, AnalyticalTable, MessageStrip, Label, Tag, BusyIndicator, Icon } from '@ui5/webcomponents-react';
import { api } from '../api';
import { useApp } from '../App.jsx';
import { inr, date } from '../format';

const APIS = [
  ['API_PURCHASEORDER_PROCESS_SRV', 'A_PurchaseOrder · A_PurchaseOrderItem', 'Read'],
  ['API_MATERIAL_DOCUMENT_SRV', 'A_MaterialDocumentItem (GR, mvt 101/102)', 'Read'],
  ['API_BUSINESS_PARTNER', 'A_Supplier', 'Read'],
  ['API_SUPPLIERINVOICE_PROCESS_SRV', 'A_SupplierInvoice (MIRO)', 'Create']
];

export default function SapExplorer() {
  const { status } = useApp();
  const [params, setParams] = useSearchParams();
  const [po, setPo] = useState(params.get('po') || '4500000117');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (n = po) => {
    setBusy(true); setError(null);
    try { setData(await api.sapPO(n.trim())); setParams({ po: n.trim() }); }
    catch (e) { setData(null); setError(e.message); }
    finally { setBusy(false); }
  };
  useEffect(() => { lookup(po); /* eslint-disable-next-line */ }, []);

  const grBy = {};
  (data?.goodsReceipts || []).forEach((g) => { grBy[g.poItem] = (grBy[g.poItem] || 0) + g.quantity; });
  const items = (data?.purchaseOrder.items || []).map((i) => ({ ...i, received: grBy[i.poItem] || 0, value: i.quantity * i.netPrice }));

  return (
    <div className="page">
      <Title level="H2" size="H3">SAP S/4HANA Integration</Title>
      <Text className="muted">Live OData calls through the ProcureIQ connector · mode <b>{status?.sapMode}</b> · {status?.sapEndpoint}</Text>

      <div className="grid-main-side" style={{ marginTop: '1rem' }}>
        <Card header={<CardHeader titleText="Purchase order lookup" subtitleText="GET A_PurchaseOrder('{PO}')?$expand=to_PurchaseOrderItem" />}>
          <div className="side-card">
            <FlexBox style={{ gap: '0.5rem' }} alignItems="Center">
              <Input value={po} onInput={(e) => setPo(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup()} placeholder="PO number e.g. 4500000117" style={{ width: 240 }} />
              <Button design="Emphasized" icon="search" onClick={() => lookup()}>Fetch from SAP</Button>
              {busy && <BusyIndicator active size="S" />}
            </FlexBox>
            {error && <MessageStrip design="Negative" hideCloseButton style={{ marginTop: '1rem' }}>{error}</MessageStrip>}
            {data && (
              <>
                <FlexBox wrap="Wrap" style={{ gap: '1rem 2rem', margin: '1rem 0' }}>
                  <div className="field"><Label>Purchase order</Label><div><b>{data.purchaseOrder.poNumber}</b></div></div>
                  <div className="field"><Label>Supplier</Label><div>{data.supplier?.name} ({data.purchaseOrder.supplier})</div></div>
                  <div className="field"><Label>Company code</Label><div>{data.purchaseOrder.companyCode}</div></div>
                  <div className="field"><Label>PO date</Label><div>{date(data.purchaseOrder.poDate)}</div></div>
                  <div className="field"><Label>Payment terms</Label><div>{data.purchaseOrder.paymentTerms}</div></div>
                  <div className="field"><Label>Goods receipts</Label><div>{[...new Set(data.goodsReceipts.map((g) => g.materialDocument))].join(', ') || 'none'}</div></div>
                </FlexBox>
                <AnalyticalTable data={items} visibleRows={Math.max(1, items.length)} scaleWidthMode="Smart" columns={[
                  { Header: 'Item', accessor: 'poItem', width: 70 },
                  { Header: 'Material', accessor: 'material', width: 130 },
                  { Header: 'Description', accessor: 'description', minWidth: 200 },
                  { Header: 'Ordered', accessor: 'quantity', width: 100, hAlign: 'End', Cell: ({ value, row }) => `${value} ${row.original.unit}` },
                  { Header: 'Received', accessor: 'received', width: 100, hAlign: 'End', Cell: ({ value, row }) => <span className={value < row.original.quantity ? 'text-warn' : ''}>{value}</span> },
                  { Header: 'Net price', accessor: 'netPrice', width: 110, hAlign: 'End', Cell: ({ value }) => inr(value, 2) },
                  { Header: 'Value', accessor: 'value', width: 130, hAlign: 'End', Cell: ({ value }) => inr(value) }
                ]} />
              </>
            )}
          </div>
        </Card>
        <Card header={<CardHeader titleText="Connected S/4HANA APIs" subtitleText="SAP Business Accelerator Hub standard APIs" />}>
          <div className="side-card">
            {APIS.map(([n, e, op]) => (
              <div key={n} className="api-row">
                <Icon name="it-system" />
                <div><b className="mono">{n}</b><br /><Text className="muted small">{e}</Text></div>
                <Tag design={op === 'Create' ? 'Critical' : 'Information'} hideStateIcon>{op}</Tag>
              </div>
            ))}
            <MessageStrip design="Information" hideCloseButton style={{ marginTop: '1rem' }}>
              Switch <code>SAP_MODE</code> to <b>sandbox</b> with an api.sap.com key, or <b>tenant</b> with a BTP destination, to run the same flows against a real S/4HANA system.
            </MessageStrip>
          </div>
        </Card>
      </div>
    </div>
  );
}
