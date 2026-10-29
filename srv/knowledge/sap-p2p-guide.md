# SAP S/4HANA Procure-to-Pay - quick reference

## Process
Purchase Requisition (ME51N) -> Purchase Order (ME21N, API_PURCHASEORDER_PROCESS_SRV) -> Goods Receipt (MIGO, movement type 101, API_MATERIAL_DOCUMENT_SRV) -> Supplier Invoice (MIRO, API_SUPPLIERINVOICE_PROCESS_SRV) -> Payment run (F110).

## GR/IR clearing account
When goods are received SAP credits the GR/IR clearing account; posting the invoice debits it. Open GR/IR balances show goods received but not invoiced (or invoiced but not received) and are reviewed at month end.

## Invoice blocking and tolerance keys
SAP blocks invoices for payment with blocking reasons when tolerance keys are exceeded, for example PP (price variance), DQ (quantity exceeds delivered quantity), BW (GR-based IV with no goods receipt) and AN/AP (amount of item without order reference). Blocked invoices are released with transaction MRBR after review.

## Supplier master
Supplier data lives in the Business Partner (API_BUSINESS_PARTNER, entity A_Supplier). Bank details, tax numbers (GSTIN), payment terms and posting blocks are maintained there.

## How ProcureIQ maps to SAP
- ProcureIQ status "Exception" corresponds to an invoice that SAP would park or block for payment.
- "Post to SAP" creates the supplier invoice through API_SUPPLIERINVOICE_PROCESS_SRV (MIRO equivalent) and stores the returned accounting document number.
