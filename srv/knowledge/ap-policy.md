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
