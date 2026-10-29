namespace procureiq;

using { cuid, managed } from '@sap/cds/common';

/**
 * Lifecycle of a supplier invoice inside ProcureIQ.
 * Received -> Extracted -> Matched | Exception -> Approved | Rejected -> Posted
 */
type InvoiceStatus : String(20) enum {
  Received;
  Extracted;
  Matched;
  Exception;
  Approved;
  Rejected;
  Posted;
}

type RiskLevel  : String(10) enum { Low; Medium; High; Critical; }
type LineStatus : String(10) enum { OK; WARN; FAIL; }
type Amount     : Decimal(15, 2);

/** Supplier master, replicated from SAP S/4HANA (A_Supplier). */
entity Vendors {
  key ID            : String(10);
      name          : String(120);
      city          : String(60);
      country       : String(3);
      gstin         : String(20);
      bankAccount   : String(34);
      category      : String(40);
      paymentTerms  : String(10);
      onboardedOn   : Date;
      postingBlocked: Boolean default false;
      riskScore     : Decimal(5, 2) default 0;
      invoices      : Association to many Invoices on invoices.vendor = $self;
}

/** A supplier invoice processed by the AI pipeline. */
entity Invoices : cuid, managed {
  invoiceNumber        : String(40);
  vendor               : Association to Vendors;
  vendorName           : String(120);
  vendorGstin          : String(20);
  bankAccount          : String(34);
  poNumber             : String(10);
  invoiceDate          : Date;
  dueDate              : Date;
  currency             : String(3) default 'INR';
  netAmount            : Amount;
  taxAmount            : Amount;
  grossAmount          : Amount;
  status               : InvoiceStatus default 'Received';
  source               : String(20) default 'Upload';
  fileName             : String(255);
  documentHash         : String(64); // sha256 of the original document - blocks re-uploads
  rawText              : LargeString;
  extractionEngine     : String(40);
  extractionConfidence : Decimal(5, 2);
  matchStatus          : String(20);
  riskScore            : Decimal(5, 2) default 0;
  riskLevel            : RiskLevel default 'Low';
  mlModel              : String(60);
  aiSummary            : LargeString;
  sapDocument          : String(20);
  sapFiscalYear        : String(4);
  decisionBy           : String(60);
  decisionComment      : String(500);
  processingMs         : Integer;
  items                : Composition of many InvoiceItems on items.parent = $self;
  matchResults         : Composition of many MatchResults on matchResults.parent = $self;
  anomalies            : Composition of many Anomalies on anomalies.parent = $self;
}

entity InvoiceItems : cuid {
  parent      : Association to Invoices;
  lineNo      : Integer;
  material    : String(40);
  description : String(255);
  quantity    : Decimal(13, 3);
  unit        : String(5);
  unitPrice   : Amount;
  amount      : Amount;
  poItem      : String(5);
}

/** Result of the 3-way match (Invoice vs Purchase Order vs Goods Receipt) per line. */
entity MatchResults : cuid {
  parent           : Association to Invoices;
  lineNo           : Integer;
  poItem           : String(5);
  material         : String(40);
  description      : String(255);
  invoiceQty       : Decimal(13, 3);
  poQty            : Decimal(13, 3);
  grQty            : Decimal(13, 3);
  invoicePrice     : Amount;
  poPrice          : Amount;
  priceVariancePct : Decimal(7, 2);
  status           : LineStatus;
  message          : String(500);
}

/** Risk signals raised by the rule engine and the ML model. */
entity Anomalies : cuid {
  parent   : Association to Invoices;
  code     : String(40);
  severity : RiskLevel;
  title    : String(120);
  detail   : String(1000);
  source   : String(10); // RULE | ML
  weight   : Decimal(5, 2);
}

/** Immutable audit trail of every pipeline step and user decision. */
entity AuditLog : cuid, managed {
  invoice : Association to Invoices;
  step    : Integer default 0; // ordering within the same timestamp
  action  : String(40);
  actor   : String(60);
  detail  : String(1000);
}
