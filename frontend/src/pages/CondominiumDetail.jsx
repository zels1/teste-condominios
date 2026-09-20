import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, FIN_TX_LABELS } from "@/lib/format";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Building2, ArrowLeft, Loader2, DoorOpen, Users, Wallet, Construction, MapPin, Landmark,
} from "lucide-react";

const CREDIT = new Set(["PAYMENT", "CREDIT", "REVERSAL"]);

function Info({ label, value }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default function CondominiumDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const { data: condo, isLoading } = useQuery({
    queryKey: ["condo", id],
    queryFn: () => api.get(`/condominiums/${id}`).then((r) => r.data),
  });
  const { data: fractions = [] } = useQuery({
    queryKey: ["fractions", id],
    queryFn: () => api.get("/fractions", { params: { condominium_id: id } }).then((r) => r.data),
  });
  const { data: owners = [] } = useQuery({
    queryKey: ["owners-list", id],
    queryFn: () => api.get("/owners", { params: { condominium_id: id } }).then((r) => r.data),
  });
  const { data: txns = [] } = useQuery({
    queryKey: ["fin-transactions", id],
    queryFn: () => api.get("/finance/transactions", { params: { condominium_id: id } }).then((r) => r.data),
  });

  if (isLoading || !condo) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const totalDebt = fractions.reduce((s, f) => s + (f.balance > 0 ? f.balance : 0), 0);

  return (
    <div data-testid="condominium-detail-page">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground" onClick={() => navigate("/condominios")} data-testid="back-btn">
        <ArrowLeft className="mr-1 h-4 w-4" /> Condomínios
      </Button>

      <div className="mb-6 flex items-start gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-primary/5 text-primary">
          <Building2 className="h-6 w-6" />
        </div>
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{condo.name}</h1>
            <StatusBadge status={condo.status} />
          </div>
          <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" />
            {[condo.address, condo.postal_code, condo.city].filter(Boolean).join(", ") || "Sem morada"}
          </p>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="border-border p-4 shadow-none"><p className="text-sm text-muted-foreground">Frações</p><p className="font-display text-2xl font-bold tabular-nums">{fractions.length}</p></Card>
        <Card className="border-border p-4 shadow-none"><p className="text-sm text-muted-foreground">Condóminos</p><p className="font-display text-2xl font-bold tabular-nums">{owners.length}</p></Card>
        <Card className="border-border p-4 shadow-none"><p className="text-sm text-muted-foreground">Em dívida</p><p className="font-display text-2xl font-bold tabular-nums text-rose-600">{formatCurrency(totalDebt)}</p></Card>
        <Card className="border-border p-4 shadow-none"><p className="text-sm text-muted-foreground">Blocos</p><p className="font-display text-2xl font-bold tabular-nums">{condo.num_blocks}</p></Card>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap justify-start" data-testid="condo-tabs">
          <TabsTrigger value="overview" data-testid="tab-overview">Resumo</TabsTrigger>
          <TabsTrigger value="fractions" data-testid="tab-fractions">Frações</TabsTrigger>
          <TabsTrigger value="owners" data-testid="tab-owners">Condóminos</TabsTrigger>
          <TabsTrigger value="finance" data-testid="tab-finance">Conta Corrente</TabsTrigger>
          <TabsTrigger value="soon" data-testid="tab-soon">Mais</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card className="grid grid-cols-2 gap-5 border-border p-6 shadow-none md:grid-cols-3">
            <Info label="NIF" value={condo.nif} />
            <Info label="Gestor" value={condo.property_manager} />
            <Info label="Ano fiscal" value={condo.fiscal_year} />
            <Info label="Banco" value={condo.bank_name} />
            <Info label="IBAN" value={condo.iban} />
            <Info label="Cidade" value={condo.city} />
          </Card>
        </TabsContent>

        <TabsContent value="fractions" className="mt-4">
          {fractions.length === 0 ? (
            <EmptyState icon={DoorOpen} title="Sem frações" />
          ) : (
            <Card className="border-border shadow-none">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Fração</TableHead><TableHead>Condómino</TableHead>
                  <TableHead className="text-right">Quota</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                  <TableHead className="text-right">Estado</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {fractions.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-semibold">{f.identifier}</TableCell>
                      <TableCell>{f.owner_name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatCurrency(f.monthly_fee)}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${f.balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>{formatCurrency(f.balance)}</TableCell>
                      <TableCell className="text-right"><StatusBadge status={f.payment_status} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="owners" className="mt-4">
          {owners.length === 0 ? (
            <EmptyState icon={Users} title="Sem condóminos" />
          ) : (
            <Card className="border-border shadow-none">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Nome</TableHead><TableHead>Contacto</TableHead>
                  <TableHead className="text-right">Frações</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {owners.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-semibold">{o.name}</TableCell>
                      <TableCell className="text-muted-foreground">{o.email || o.phone || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{o.fraction_count}</TableCell>
                      <TableCell className={`text-right font-semibold tabular-nums ${o.balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>{formatCurrency(o.balance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="finance" className="mt-4">
          {txns.length === 0 ? (
            <EmptyState icon={Wallet} title="Sem movimentos" />
          ) : (
            <Card className="border-border shadow-none">
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Data</TableHead><TableHead>Descrição</TableHead>
                  <TableHead>Fração</TableHead><TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Montante</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {txns.slice(0, 50).map((t) => {
                    const credit = CREDIT.has(t.transaction_type);
                    return (
                      <TableRow key={t.id}>
                        <TableCell className="tabular-nums text-muted-foreground">{formatDate(t.date)}</TableCell>
                        <TableCell className="font-medium">{t.description || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{t.fraction_identifier}</TableCell>
                        <TableCell className="text-xs font-semibold">{FIN_TX_LABELS[t.transaction_type]}</TableCell>
                        <TableCell className={`text-right font-semibold tabular-nums ${credit ? "text-emerald-600" : "text-rose-600"}`}>
                          {credit ? "−" : "+"}{formatCurrency(t.amount)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="soon" className="mt-4">
          <EmptyState
            icon={Construction}
            title="Despesas, Fornecedores, Ocorrências, Documentos e Assembleias"
            description="Estes separadores fazem parte das próximas fases do DOMVUS e estarão disponíveis em breve."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
