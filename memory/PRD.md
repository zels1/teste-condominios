# DOMVUS — Product Requirements Document

## Original Problem Statement
Production-quality multi-tenant SaaS for Portuguese condominium/property management (inspired by GECond, original implementation). Two user types: Administrator/Property Manager and Condómino/Owner. Modules: Dashboard, Condominiums, Fractions, Owners, Financial Management, Expenses, Documents, Suppliers, Maintenance, Communications, Meetings, User Management, Settings. European Portuguese UI, EUR. Build in phases; Phase 1 = foundation only.

## Architecture
- **Backend**: FastAPI (modular monolith) — `server.py` (wiring/startup/seed/CORS), `auth.py` (JWT + RBAC + brute force + password reset + audit), `routes.py` (business CRUD + dashboard + tenant scoping), `models.py`, `seed.py`, `database.py`. MongoDB via motor.
- **Frontend**: React 19 + React Router 7 + TanStack Query + Tailwind + shadcn/ui + Recharts. `@`→`src` alias.
- **Auth**: JWT httpOnly cookies (samesite=none, secure) + Bearer fallback; refresh token; token_version invalidation; bcrypt.
- **Multi-tenancy**: every business entity carries `organization_id`. Backend `org_filter()` + `accessible_condo_ids()` enforce isolation (owner restricted to own condominium/owner_id; 403 on cross-tenant access). Verified by tests.
- **Finance**: transaction-based. Balance computed from transactions: sum(charges/debits) − sum(payments/credits). No stored balance fields.

## Roles
super_admin (all orgs), property_manager, admin_staff (org-scoped, full staff CRUD), owner (read-only, own data only).

## User Personas
1. Property manager — manages multiple condos, finances, records.
2. Administrative staff — data entry/support.
3. Condómino/Owner — views only own condominium, fraction, balance, transactions.

## Core Requirements (static)
Auth + roles, backend tenant isolation, condominiums/fractions/owners relationships, transaction-based finance, dashboard with KPIs + charts, audit logging, seed data, PT UI/EUR.

## Implemented (2026-06)
- [2026-06] JWT auth (login/register/logout/me/refresh/forgot/reset), brute-force lockout, admin+demo seeding.
- [2026-06] 4 demo accounts; real super_admin master.marques@gmail.com.
- [2026-06] Multi-tenant backend isolation + RBAC (verified 20/20 tests).
- [2026-06] Condominiums CRUD (+detail page with tabs), Fractions CRUD, Owners CRUD.
- [2026-06] Transactions (charge/payment/credit/debit) with computed balances + delete.
- [2026-06] Dashboard: 6 KPIs, faturado vs recebido bar chart, debt aging, monthly cash flow, recent payments, condo filter.
- [2026-06] Users list page; audit_logs collection populated on writes.
- [2026-06] Seed: 3 condos, 18 fractions/owners, 4 months charges + partial payments (outstanding balances).
- [2026-06] Coming-soon pages for Fornecedores, Recebimentos, Despesas, Relatórios, Ocorrências, Manutenção, Comunicações, Assembleias, Documentos, Definições.
- [2026-06] Design: Swiss/high-contrast, Manrope + IBM Plex Sans, light theme, dense tables, status badges.

## Backlog (prioritized)
### P1 — Phase 2 Finance
- Expenses module (supplier invoices, VAT, categories, attachments).
- Suppliers module (NIF, IBAN, services, associated condos, invoice history).
- Recebimentos reconciliation view; account statements per owner/fraction (PDF export).
- Financial reports (income/expense, balance sheet per condo).
- Edit dialogs for fractions/owners/transactions (create+delete done; edit pending).
- True overdue metric (30/60/90 day aging separate from total receivable).

### P2 — Phase 3 Operations
- Maintenance/Occurrences (status workflow, priority, assignee, photos, comments, cost).
- Documents (upload/storage via object storage, entity linking, categories).
- Communications (compose to condo/block/fractions/owners, drafts, scheduled; email later).
- Meetings/Assemblies (agenda, attendees, minutes, decisions; voting later).

### P2 — Phase 4 Owner Portal polish
- Dedicated owner dashboard surfacing own charges/payments/documents/communications.

### P3 — Phase 5 Automation/AI
- Payment reminders, email automation, WhatsApp, OCR invoices, AI document/email/minutes.

## Known non-blocking items
- fraction_balance / list_owners do N+1 queries — fine at current scale; move to $group aggregation when data grows.
- Recharts width/height console warnings on first paint (cosmetic).
- Dialogs missing DialogDescription (a11y warning only).

## Phase 2 — Financial Engine (Implemented 2026-06)
- [2026-06] Transaction-based accounting ledger in integer cents (`money.py`, `finance.py`); balances always derived = Σ(debit)−Σ(credit). Immutable ledger; corrections via CREDIT/REVERSAL preserving originals.
- [2026-06] Charge types, charge configs (FIXED_AMOUNT/PERMILAGE/FRACTION_SPECIFIC/MANUAL), annual budgets with lines + approval.
- [2026-06] Idempotent quota generation (generation_key per fraction+period).
- [2026-06] Payments with oldest-first & manual allocation; partial payments; overpayment kept as credit_remaining; receipt numbering.
- [2026-06] Manual charges, credit notes, reversals.
- [2026-06] Conta corrente statement (running balance), debt aging (7 buckets by due_date), per-fraction debts list.
- [2026-06] Finance dashboard (receivable, overdue, received/expenses/cashflow, in-debt counts, 6-month series, aging, outstanding by condo).
- [2026-06] Suppliers, expenses (VAT, categories, status), bank accounts (IBAN masked for owners).
- [2026-06] 8 reports (receivable, owner_debt, aging, payments, charges, expenses, income_vs_expenses, condo_summary) + CSV export.
- [2026-06] PDF receipt + payment notice (reportlab, PT/EUR).
- [2026-06] Owner portal "Minha Conta" (own statement, balance, receipts) — strict backend isolation.
- [2026-06] Frontend Finance section: Visão Geral, Conta Corrente, Quotas, Recebimentos, Dívidas, Despesas, Orçamento, Relatórios + Fornecedores.
- [2026-06] Verified: 12/12 finance tests (TESTs 1–10), 20/20 Phase-1 regressions.
- Rounding: EUR 2dp, ROUND_HALF_UP (permillage & splits; remainder cent on first period → exact annual totals).

## Known non-blocking items (Phase 2)
- N+1 balance queries in dashboard/debts/reports (fine at MVP scale; move to $group aggregation later).
- create_payment not wrapped in a Mongo multi-doc transaction (standalone mongod); uses compensation on failure.
- Some Radix Dialogs lack DialogDescription (a11y warning only).

## Phase 4 — Portal do Condómino (Implemented 2026-06)
- [2026-06] Dedicated owner dashboard (`OwnerDashboard.jsx`) routed via `DashboardRouter` (owner→OwnerDashboard, staff→Dashboard): balance hero (dívida/crédito/regularizado), próximo pagamento, quick-action tiles, as minhas frações, o meu condomínio, recebimentos recentes com recibo PDF.
- [2026-06] New backend endpoint `GET /api/finance/owner-summary` (owner-only, staff/super_admin → 403) aggregating own balance, next_due, fractions, condominiums, recent payments, counts (communications, open_occurrences matching visibility rule).
- [2026-06] Owner sidebar: Dashboard, Minha Conta, Ocorrências, Comunicações (novo), Documentos. Comunicações: compose + "Destinatários" ocultos para condómino (inbox read-only).
- [2026-06] Security hardening (from iteration_3 review):
  - `list_occurrences` + `get_occurrence`: owner só vê ocorrências da própria fração, de áreas comuns (sem fração) ou por si reportadas; detalhe de fração alheia → 403/404.
  - `_can_access_document`: owner só acede a docs da própria fração/owner ou docs do próprio condomínio NÃO confidenciais (bloqueia categorias Confidencial/Pessoal/RH/Privado); docs de outro condomínio → 403.
  - `list_fractions`: owner recebe apenas as suas próprias frações (sem leak de vizinhos).
- [2026-06] Verified: 14/14 Phase-4 tests + 30/30 regression (ops 18 + finance 12) = 44/44. Frontend flows (owner portal, sidebar scoping, comunicações gating) pass.

## Phase 5 — Assembleias: Quórum & Votação por Permilagem (Implemented 2026-06)
- [2026-06] Cálculo de quórum: `_condo_permillage` soma permilagem de todas as frações; `_assembly_detail` calcula present_permillage (frações present/represented), present_pct, quorum_met — 1ª convocatória exige >500‰; 2ª convocatória delibera com qualquer >0‰ (staff alterna via PUT /ops/assemblies/{id}).
- [2026-06] Votação ponderada por permilagem: POST /ops/assemblies/{id}/vote com upsert por (assembly, agenda_number, fraction_id); tallies em ‰ + contagens; percentagens sobre presentes e sobre total; resultado approved/rejected/tie/pending (maioria dos presentes). Votar marca a fração como presente.
- [2026-06] Isolamento: condómino vota apenas pela própria fração (owner_guard); staff vota por qualquer fração do condomínio; PUT convocatória é staff-only.
- [2026-06] Frontend: nova página `AssembleiaDetail` (painel de quórum com barra, toggle 1ª/2ª convocatória, presenças [staff], votação por ponto com barras e badge de resultado, votação do condómino no portal). Cartões clicáveis; Assembleias no OWNER_GROUPS; criar assembleia só staff.
- [2026-06] Verificado: 7/7 testes Phase 5 + 44/44 regressão = 51/51; fluxos frontend staff/condómino aprovados.

## Next Tasks
Phase 5 Automation/AI: payment reminders, email automation (Resend), WhatsApp, OCR invoices, AI document/email/minutes. Then Assembly voting/quorum logic and bank reconciliation (BANK_TRANSACTION schema prepared).
