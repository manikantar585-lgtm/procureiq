using procureiq as db from '../db/schema';

/**
 * P2PService - the OData V4 API behind the ProcureIQ Fiori app.
 * Roles:  Clerk    - upload & view invoices, ask the copilot
 *         Approver - approve / reject / post invoices to SAP
 *         Manager  - releases high-value / critical invoices, full audit view
 */
@path    : '/odata/v4/p2p'
@requires: 'authenticated-user'
service P2PService {

  @readonly
  entity Vendors      as projection on db.Vendors;

  @readonly
  entity Invoices     as projection on db.Invoices excluding { rawText }
    actions {
      @requires: 'Approver'
      action approveInvoice(comment : String) returns Invoices;

      @requires: 'Approver'
      action rejectInvoice(reason : String)   returns Invoices;

      @requires: 'Approver'
      action postToSAP()                returns Invoices;
    };

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
  }

  /** Upload a supplier invoice (PDF or text, base64) and run the full AI pipeline. */
  action   uploadInvoice(fileName : String, contentBase64 : LargeString) returns UploadResult;

  /** Ask the agentic copilot a question in natural language. */
  action   askCopilot(question : String, history : LargeString)          returns CopilotAnswer;

  function kpis()                                                         returns KPI;
  function systemStatus()                                                 returns SystemStatus;
  /** Live lookup of a purchase order in SAP S/4HANA (API_PURCHASEORDER_PROCESS_SRV). */
  function sapPurchaseOrder(poNumber : String)                            returns LargeString;
}
