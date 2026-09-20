import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, PAY_METHOD_LABELS } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { openPdf } from "@/components/shared/StatementView";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  Wallet, CheckCircle2, AlertTriangle, CalendarClock, Building2, DoorOpen,
  UserCircle, FolderOpen, Megaphone, FileDown, ArrowRight, Loader2, Receipt,
} from "lucide-react";

function ActionTile({ icon: Icon, label, hint, badge, onClick, testid }) {
  return (
    <button
      onClick={onClick}
      data-testid={testid}
      className="group relative flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
    >
      {badge > 0 && (
        <span className="absolute right-3 top-3 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1.5 text-[11px] font-bold text-white">
          {badge}
        </span>
      )}
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </span>
      <div>
        <p className="text-sm font-semibold">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <ArrowRight className="mt-1 h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

export default function OwnerDashboard() {
  const { user } = useAuth();
  const nav = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ["owner-summary"],
    queryFn: () => api.get("/finance/owner-summary").then((r) => r.data),
  });

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const t = data.totals;
  const firstName = (data.owner_name || user?.name || "").split(" ")[0];
  const inDebt = t.outstanding > 0;
  const primaryFraction = data.fractions[0];

  return (
    <div data-testid="owner-dashboard-page" className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
          Olá, {firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">Portal do Condómino · a sua área pessoal</p>
      </div>

      {/* Balance hero */}
      <Card
        data-testid="owner-balance-card"
        className={`overflow-hidden border-border p-6 shadow-none ${inDebt ? "bg-rose-50" : t.credit > 0 ? "bg-emerald-50" : "bg-muted/40"}`}
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              {inDebt ? <AlertTriangle className="h-4 w-4 text-rose-600" /> : <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
              {inDebt ? "Saldo em dívida" : t.credit > 0 ? "Saldo a seu favor" : "Conta regularizada"}
            </div>
            <p className={`mt-1 font-display text-4xl font-extrabold tracking-tight tabular-nums ${inDebt ? "text-rose-700" : "text-emerald-700"}`}>
              {inDebt ? formatCurrency(t.outstanding) : t.credit > 0 ? formatCurrency(t.credit) : formatCurrency(0)}
            </p>
            {!inDebt && t.credit === 0 && <p className="mt-1 text-sm text-muted-foreground">Não tem valores em dívida. Obrigado!</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {inDebt && primaryFraction && (
              <Button onClick={() => openPdf(`/finance/notice/${primaryFraction.id}`)} data-testid="owner-notice-btn">
                <FileDown className="mr-2 h-4 w-4" /> Aviso de Pagamento
              </Button>
            )}
            <Button variant="outline" onClick={() => nav("/minha-conta")} data-testid="owner-view-account-btn">
              Ver conta corrente <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>

      {/* Next due */}
      {data.next_due && (
        <Card data-testid="owner-next-due-card" className="flex items-center gap-4 border-border p-4 shadow-none">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-amber-100 text-amber-700">
            <CalendarClock className="h-5 w-5" />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold">Próximo pagamento — {data.next_due.description}</p>
            <p className="text-xs text-muted-foreground">
              Fração {data.next_due.fraction_identifier} · vencimento {formatDate(data.next_due.due_date)}
            </p>
          </div>
          <span className="font-display text-lg font-bold tabular-nums">{formatCurrency(data.next_due.amount)}</span>
        </Card>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <ActionTile icon={UserCircle} label="Minha Conta" hint="Extrato e recibos" onClick={() => nav("/minha-conta")} testid="owner-tile-account" />
        <ActionTile icon={AlertTriangle} label="Ocorrências" hint="Reportar / acompanhar" badge={data.counts.open_occurrences} onClick={() => nav("/ocorrencias")} testid="owner-tile-occurrences" />
        <ActionTile icon={Megaphone} label="Comunicações" hint="Avisos do condomínio" badge={data.counts.communications} onClick={() => nav("/comunicacoes")} testid="owner-tile-communications" />
        <ActionTile icon={FolderOpen} label="Documentos" hint="Atas e regulamentos" onClick={() => nav("/documentos")} testid="owner-tile-documents" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* My fractions */}
        <Card className="border-border p-5 shadow-none lg:col-span-2" data-testid="owner-fractions-card">
          <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold">
            <DoorOpen className="h-4 w-4 text-muted-foreground" /> As minhas frações
          </h3>
          <div className="divide-y divide-border">
            {data.fractions.map((f) => (
              <div key={f.id} className="flex items-center justify-between py-3" data-testid={`owner-fraction-${f.id}`}>
                <div>
                  <p className="text-sm font-semibold">Fração {f.identifier}</p>
                  <p className="text-xs text-muted-foreground">{f.condominium_name}{f.permillage ? ` · ${f.permillage}‰` : ""}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`tabular-nums text-sm font-semibold ${f.outstanding > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {f.outstanding > 0 ? formatCurrency(f.outstanding) : f.credit > 0 ? `+${formatCurrency(f.credit)}` : formatCurrency(0)}
                  </span>
                  <StatusBadge status={f.outstanding > 0 ? "pendente" : "pago"} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* My condominium */}
        <Card className="border-border p-5 shadow-none" data-testid="owner-condo-card">
          <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold">
            <Building2 className="h-4 w-4 text-muted-foreground" /> O meu condomínio
          </h3>
          {data.condominiums.map((c) => (
            <div key={c.id} className="mb-3 last:mb-0">
              <p className="text-sm font-semibold">{c.name}</p>
              <p className="text-xs text-muted-foreground">
                {[c.address, c.postal_code, c.city].filter(Boolean).join(", ") || "—"}
              </p>
            </div>
          ))}
        </Card>
      </div>

      {/* Recent payments */}
      <Card className="border-border p-5 shadow-none" data-testid="owner-recent-payments">
        <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold">
          <Receipt className="h-4 w-4 text-muted-foreground" /> Recebimentos recentes
        </h3>
        {data.recent_payments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Ainda não há recebimentos registados.</p>
        ) : (
          <div className="divide-y divide-border">
            {data.recent_payments.map((p) => (
              <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                <div>
                  <p className="font-medium">{p.receipt_number}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(p.date)} · {PAY_METHOD_LABELS[p.method] || p.method}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums text-emerald-600">{formatCurrency(p.amount)}</span>
                  <Button variant="ghost" size="sm" className="h-8" onClick={() => openPdf(`/finance/payments/${p.id}/receipt`)} data-testid={`owner-receipt-${p.id}`}>
                    <FileDown className="mr-1 h-4 w-4" /> Recibo
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
