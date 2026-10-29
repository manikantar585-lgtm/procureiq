# ProcureIQ: resume bullets and interview guide

## Resume bullets (pick 3–4)

- Built **ProcureIQ**, an agentic AI Procure-to-Pay copilot for **SAP S/4HANA** on **SAP CAP** (Node.js, OData V4) and **SAP Fiori / UI5 Web Components**, deployable to **SAP BTP** (MTA, HANA Cloud, XSUAA).
- Designed a GenAI document pipeline (LLM JSON extraction with arithmetic validation) that processes supplier invoices end-to-end in **under 1 second**. It achieves an **~82 % touchless 3-way match** against live S/4HANA purchase orders and goods receipts.
- Developed a hybrid **IsolationForest + Gradient Boosting** fraud model (FastAPI, scikit-learn) with perturbation-based explanations, reaching **ROC-AUC 0.99** on held-out data. It is combined with 14 explainable rules that catch duplicates, bank-account fraud, split invoicing and over-billing.
- Implemented a **tool-calling LLM agent** (6 tools over SAP APIs, the invoice ledger and BM25 RAG over policy) with a provider-agnostic client (Gemini, OpenAI, Groq, Ollama, Claude, SAP AI Core) and an offline fallback.
- Shipped with role-based segregation of duties, an immutable audit trail, Docker Compose, GitHub Actions CI and **33 automated tests**.

## 60-second pitch

"Companies on SAP still check supplier invoices by hand against the purchase order and goods receipt, which is slow, and fraud slips through. I built ProcureIQ on SAP's own stack, CAP and Fiori. An LLM reads the invoice. My match engine checks it live against S/4HANA using the same tolerance logic as SAP's MIRO. A rule engine plus an ML ensemble scores fraud risk with explanations. Clean invoices go straight to approval, risky ones are blocked with a reason, and an AI agent answers AP questions by calling tools over SAP data and company policy. It runs fully offline too, and deploys to SAP BTP."

## Questions you will be asked, and strong answers

**Why both rules and ML?** Rules are explainable and catch known patterns with certainty: a changed bank account is always critical. ML catches unusual combinations nobody wrote a rule for. Severity floors ensure ML can never average away a critical rule.

**Why IsolationForest + Gradient Boosting?** IsolationForest needs no labels and catches novel anomalies. Gradient Boosting learns from past audit outcomes. On my held-out set the unsupervised model alone scores ROC-AUC 0.86 and the ensemble 0.99. I'm also clear that this data is synthetic; production would retrain on SAP tables RBKP/RSEG plus audit labels.

**How do you stop the LLM from hallucinating amounts?** Three ways. Strict JSON schema output. Deterministic arithmetic validation (lines must sum to subtotal, subtotal + tax must equal total), which drives a confidence score. And the agent can only answer from tool results, with sources shown in the UI.

**How does it talk to SAP?** Through the standard S/4HANA OData V2 APIs: purchase order, material document, business partner and supplier invoice. One connector supports a mock mode, the SAP Business Accelerator Hub sandbox, and a real tenant (including the CSRF-token flow for POST). On BTP you would use a Destination.

**What is a 3-way match?** Invoice vs purchase order (price, item) vs goods receipt (quantity actually received). SAP blocks payment with tolerance keys such as PP (price), DQ (quantity) and BW (no goods receipt). My engine implements those.

**How would you scale it?** Event-driven intake (SAP Event Mesh), HANA Cloud for persistence and vector search, a horizontally scaled stateless CAP service, the ML service as its own container, and LLM calls with caching and retries.

## Demo script (3 minutes)

1. Sign in as **Ravi (Approver)** and walk through the Overview KPIs.
2. Open **Capture Invoice**, click "Bank account ≠ vendor master", and watch the pipeline. The invoice is blocked as Critical.
3. Open the invoice: show the AI reviewer note, the findings and the 3-way match table.
4. In **Copilot**, ask "Any bank account fraud or split invoicing?" and expand the agent trace.
5. Approve a clean invoice, then **Post to SAP** to get the SAP document number. Switch to **Priya (Manager)** and show the audit trail.
