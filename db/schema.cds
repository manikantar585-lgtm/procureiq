namespace procureiq;

using { cuid, managed } from '@sap/cds/common';

/**
 * Lifecycle of a supplier invoice inside ProcureIQ.
 * Received -> Extracted -> Matched | Exception (<-> OnHold) -> Approved | Rejected -> Posted -> Paid
 */
type InvoiceStatus : String(20) enum {
  Received;
  Extracted;
  Matched;
  Exception;
  OnHold;
  Approved;
  Rejected;
  Posted;
  Paid;
}

type HoldCategory : String(30) enum {
  VendorDispute;
  AwaitingCreditNote;
  AwaitingGoodsReceipt;
  BuyerConfirmation;
  Other;
}

type RequestStatus : String(10) enum { Pending; Approved; Rejected; }

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
      // ProcureIQ-side payment block (SAP: supplier payment block) - stops payment runs, flags new invoices
      paymentBlocked: Boolean default false;
      blockReason   : String(500);
      blockedBy     : String(60);
      blockedAt     : Timestamp;
      invoices      : Association to many Invoices on invoices.vendor = $self;
      bankChanges   : Association to many BankChangeRequests on bankChanges.vendor = $self;
}

/** Bank master change under dual control (four-eyes): requested by one user, approved by a different Finance Manager. */
entity BankChangeRequests : cuid, managed {
  vendor            : Association to Vendors;
  oldAccount        : String(34);
  newAccount        : String(34);
  reason            : String(500);
  callbackConfirmed : Boolean default false; // vendor called back on the master-data phone number
  status            : RequestStatus default 'Pending';
  requestedBy       : String(60);
  decidedBy         : String(60);
  decidedAt         : Timestamp;
  decisionComment   : String(500);
}

/** F110-style payment run: pays posted invoices that are due (or worth paying early for the cash discount). */
entity PaymentRuns : cuid, managed {
  runId          : String(20);
  paymentDate    : Date;
  invoiceCount   : Integer;
  grossAmount    : Amount;
  discountAmount : Amount;
  paidAmount     : Amount;
  executedBy     : String(60);
  invoices       : Association to many Invoices on invoices.paymentRun = $self;
}

/** Runtime-configurable business rules (tolerances, approval limit, SLA). */
entity Settings : managed {
  key name     : String(40);
      value    : Decimal(15, 2);
      label    : String(80);
      unit     : String(10);
      minValue : Decimal(15, 2);
      maxValue : Decimal(15, 2);
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
  receivedAt           : Timestamp; // when the document entered AP - starts the exception SLA clock
  // hold / dispute
  holdCategory         : HoldCategory;
  holdReason           : String(500);
  heldBy               : String(60);
  heldAt               : Timestamp;
  statusBeforeHold     : InvoiceStatus;
  // SLA escalation
  escalated            : Boolean default false;
  escalatedAt          : Timestamp;
  // payment
  paymentRun           : Association to PaymentRuns;
  paidOn               : Date;
  paidAmount           : Amount;
  discountTaken        : Amount;
  items                : Composition of many InvoiceItems on items.parent = $self;
  matchResults         : Composition of many MatchResults on matchResults.parent = $self;
  anomalies            : Composition of many Anomalies on anomalies.parent = $self;
  comments             : Composition of many InvoiceComments on comments.parent = $self;
}

/** Discussion thread on an invoice (AP clerk, buyer, approver). */
entity InvoiceComments : cuid, managed {
  parent     : Association to Invoices;
  text       : String(1000);
  author     : String(60);
  authorName : String(120);
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
  vendor  : Association to Vendors;
  step    : Integer default 0; // ordering within the same timestamp
  action  : String(40);
  actor   : String(60);
  detail  : String(1000);
}
