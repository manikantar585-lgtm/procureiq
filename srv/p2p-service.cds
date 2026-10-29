using procureiq as db from '../db/schema';

/**
 * P2PService - the OData V4 API behind the ProcureIQ Fiori app.
 * Roles:  Clerk    - upload & view invoices, hold / comment, request bank changes, ask the copilot
 *         Approver - approve / reject / post invoices to SAP, block vendor payments
 *         Manager  - releases high-value / critical invoices, payment runs, settings,
 *                    bank-change approval (four-eyes), full audit view
 */
@path    : '/odata/v4/p2p'
@requires: 'authenticated-user'
service P2PService {

  @readonly
  entity Vendors      as projection on db.Vendors
    actions {
      @requires: 'Approver'
      action blockPayments(reason : String)   returns Vendors;

      @requires: 'Manager'
      action unblockPayments(reason : String) returns Vendors;

      @requires: 'Clerk'
      action requestBankChange(newAccount : String, reason : String, callbackConfirmed : Boolean) returns BankChangeRequests;
    };

  @readonly
  entity BankChangeRequests as projection on db.BankChangeRequests
    actions {
      @requires: 'Manager'
      action approveBankChange(comment : String) returns BankChangeRequests;

      @requires: 'Manager'
      action rejectBankChange(comment : String)  returns BankChangeRequests;
    };

  @readonly
  entity Invoices     as projection on db.Invoices excluding { rawText }
    actions {
      @requires: 'Approver'
      action approveInvoice(comment : String) returns Invoices;

      @requires: 'Approver'
      action rejectInvoice(reason : String)   returns Invoices;

      @requires: 'Approver'
      action postToSAP()                returns Invoices;

      /** Park the invoice (vendor dispute, waiting for a credit note or goods receipt, ...). */
      @requires: 'Clerk'
      action holdInvoice(category : String, reason : String) returns Invoices;

      @requires: 'Clerk'
      action releaseHold(comment : String)    returns Invoices;

      @requires: 'Clerk'
      action addComment(text : String)        returns InvoiceComments;

      /** PDF audit evidence for one invoice, base64 encoded. */
      @requires: 'Approver'
      function auditReport()                  returns LargeString;

      /** Permanently delete an invoice that has not reached SAP (test upload, wrong document). */
      @requires: 'Manager'
      action deleteInvoice(reason : String)   returns Boolean;
    };

  @readonly
  entity InvoiceComments as projection on db.InvoiceComments;

  @readonly
  @requires: 'Approver'
  entity PaymentRuns  as projection on db.PaymentRuns;

  @readonly
  entity Settings     as projection on db.Settings;

  @readonly
  entity InvoiceItems as projection on db.InvoiceItems;

  @readonly
  entity MatchResults as projection on db.MatchResults;

  @readonly
  entity Anomalies    as projection on db.Anomalies;

  @readonly
  @requires: ['Approver', 'Manager']
  entity AuditLog     as projection on db.AuditLog;

  type UploadResult {
    ID            : UUID;
    invoiceNumber : String;
    status        : String;
    riskLevel     : String;
    processingMs  : Integer;
  }

  type CopilotSource {
    kind  : String;
    ref   : String;
    title : String;
  }

  type CopilotAnswer {
    answer     : LargeString;
    engine     : String;
    toolCalls  : array of String;
    sources    : array of CopilotSource;
  }

  type KPI {
    totalInvoices     : Integer;
    totalSpend        : Decimal(15, 2);
    autoMatchedPct    : Decimal(5, 2);
    exceptions        : Integer;
    highRisk          : Integer;
    pendingApproval   : Integer;
    posted            : Integer;
    avgProcessingMs   : Integer;
    savingsIdentified : Decimal(15, 2);
    openPayables      : Decimal(15, 2);
    overduePayables   : Decimal(15, 2);
    onHold            : Integer;
    slaBreaches       : Integer;
    statusBreakdown   : LargeString; // JSON
    riskBreakdown     : LargeString; // JSON
    spendByVendor     : LargeString; // JSON
    monthlyTrend      : LargeString; // JSON
  }

  type SystemStatus {
    sapMode     : String;
    sapEndpoint : String;
    llmProvider : String;
    llmModel    : String;
    mlService   : String;
    mlModel     : String;
    database    : String;
  }

  /** Upload a supplier invoice (PDF or text, base64) and run the full AI pipeline. */
  action   uploadInvoice(fileName : String, contentBase64 : LargeString) returns UploadResult;

  /** Ask the agentic copilot a question in natural language. */
  action   askCopilot(question : String, history : LargeString)          returns CopilotAnswer;

  function kpis()                                                         returns KPI;
  function systemStatus()                                                 returns SystemStatus;
  /** Live lookup of a purchase order in SAP S/4HANA (API_PURCHASEORDER_PROCESS_SRV). */
  function sapPurchaseOrder(poNumber : String)                            returns LargeString;

  // ---------------------------------------------------------------- bulk decisions
  type BulkResult {
    ID            : UUID;
    invoiceNumber : String;
    ok            : Boolean;
    message       : String;
  }

  @requires: 'Approver'
  action   bulkApprove(invoiceIds : array of UUID, comment : String)     returns array of BulkResult;

  @requires: 'Approver'
  action   bulkReject(invoiceIds : array of UUID, reason : String)       returns array of BulkResult;

  // ---------------------------------------------------------------- payments
  /** Payment proposal (F110-style) for a payment date: aging, cash-out forecast, items to pay. JSON. */
  @requires: 'Approver'
  function paymentProposal(paymentDate : Date, horizonDays : Integer)    returns LargeString;

  /** Pay the selected posted invoices; segregation of duties: Finance Manager only. */
  @requires: 'Manager'
  action   executePaymentRun(paymentDate : Date, invoiceIds : array of UUID) returns PaymentRuns;

  // ---------------------------------------------------------------- controls
  @requires: 'Manager'
  action   updateSetting(name : String, value : Decimal(15, 2))          returns Settings;

  /** Escalate exceptions and holds that are past the SLA. Returns the number of newly escalated invoices. */
  @requires: 'Approver'
  action   runSlaCheck()                                                  returns Integer;

  /** Permanently delete ALL data and reload the demo invoices. Returns the number of seeded invoices. */
  @requires: 'Manager'
  action   resetData()                                                    returns Integer;
}
