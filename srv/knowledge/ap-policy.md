# Aurora Industries Ltd - Accounts Payable Policy (AP-POL-004, rev. 3)

## Approval matrix
Invoices are approved according to their gross amount including GST:
- Up to INR 1,00,000: may be approved by an AP Clerk when the 3-way match is clean and risk is Low.
- INR 1,00,000 to INR 10,00,000: requires an Approver (Procurement Lead or AP Lead).
- Above INR 10,00,000: requires Finance Manager approval in addition to the Approver.
Splitting a purchase or invoice to stay below an approval limit is a policy violation and must be reported to Internal Audit.

## Three-way match tolerances
Every PO-based invoice must be matched against the Purchase Order and the Goods Receipt in SAP S/4HANA (GR-based invoice verification).
- Price: an invoice unit price up to 2% above the PO net price is accepted automatically. 2% to 5% requires buyer confirmation. Above 5% the invoice is blocked for payment until a credit note or PO amendment is received.
- Quantity: the invoiced quantity may never exceed the quantity received (movement type 101 minus returns 102). Partial deliveries must be invoiced partially.
- Unordered items: lines that do not exist on the PO are rejected.

## Duplicate payments
The system blocks any invoice whose vendor and normalised invoice number already exist. Invoices with the same vendor and identical gross amount within 30 days are flagged as possible duplicates and must be reviewed.

## Bank account changes
A bank account on an invoice that differs from the SAP vendor master is treated as a potential vendor-impersonation (business email compromise) attempt. Payment stays blocked. The vendor must be called back on the phone number stored in the vendor master (never the number on the invoice). Bank master changes require dual control by the Master Data team.

## GST compliance
The supplier GSTIN on the invoice must match the GSTIN in the vendor master and must be active. Input tax credit cannot be claimed on invoices with a mismatched GSTIN. Intra-state supplies (both parties in Telangana, state code 36) carry CGST + SGST; inter-state supplies carry IGST.

## MSME vendors
Under Section 15 of the MSMED Act, invoices from registered micro and small enterprises must be paid within the agreed terms and never later than 45 days from acceptance. Delayed MSME payments are disallowed as a tax deduction under Section 43B(h) of the Income Tax Act until paid.

## Non-PO spend
Invoices without a valid purchase order ("maverick spend") are only allowed for utilities, statutory payments and pre-approved categories. All others require Finance Manager approval and a retrospective PO.

## New vendors
Vendors onboarded within the last 90 days are under enhanced monitoring: their first invoices above INR 2,00,000 require a second approver.

## Exception SLA and escalation
Invoices with open exceptions must be resolved within 5 days of receipt (setting "Exception / hold SLA"). Invoices on hold must be resolved within 5 days of being put on hold. ProcureIQ checks the SLA every hour and escalates breaches to the Finance Manager, with an audit-trail entry. Putting an invoice on hold requires a category (vendor dispute, awaiting credit note, awaiting goods receipt, buyer confirmation, other) and a reason; held invoices cannot be approved until the hold is released.

## Payment runs and cash discounts
Only invoices posted to SAP S/4HANA are paid. The payment run pays every invoice that is overdue or due within the run horizon (default 7 days), and pays early when a cash discount is still available (for example 2% within 10 days, net 30). Payment runs are executed by the Finance Manager only, so the person who approves an invoice never releases its payment (segregation of duties). Payment dates cannot be in the past.

## Vendor payment blocks
An Approver or the Finance Manager may block all payments to a vendor, for example during a fraud investigation or while bank details are being verified. A blocked vendor's invoices are excluded from payment runs and new invoices from the vendor are flagged as Critical. Only the Finance Manager can lift a payment block, and a reason is recorded either way.
