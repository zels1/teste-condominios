# DOMVUS Auth Testing

Backend: FastAPI at http://localhost:8001, all routes under /api. Auth under /api/auth.
DB: MongoDB, database from DB_NAME env.

## Accounts (see /app/memory/test_credentials.md)
- super_admin: master.marques@gmail.com / Domvus2025!  (sees ALL condominiums)
- property_manager: gestor@domvus.pt / Domvus2025!
- admin_staff: staff@domvus.pt / Domvus2025!
- owner: condomino@domvus.pt / Domvus2025!  (only their own condominium/fraction)

## Endpoints
- POST /api/auth/register | login | logout | refresh | forgot-password | reset-password
- GET  /api/auth/me
- GET/POST/PUT/DELETE /api/condominiums
- GET/POST/PUT/DELETE /api/fractions
- GET/POST/PUT/DELETE /api/owners
- GET/POST/DELETE /api/transactions
- GET /api/dashboard
- GET /api/users

## Cookie login
curl -c cookies.txt -X POST http://localhost:8001/api/auth/login -H "Content-Type: application/json" -d '{"email":"master.marques@gmail.com","password":"Domvus2025!"}'
curl -b cookies.txt http://localhost:8001/api/auth/me

## Key checks
- Tenant isolation: owner (condomino@domvus.pt) GET /api/condominiums returns only their own condo; GET /api/transactions returns only their owner_id; accessing another condo id returns 403.
- RBAC: owner POST /api/condominiums returns 403.
- Finance: fraction balance = sum(charges) - sum(payments), computed from transactions.
