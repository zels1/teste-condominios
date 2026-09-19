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

## Next Tasks
Phase 2 Finance: start with Expenses + Suppliers modules and per-owner account statements.
