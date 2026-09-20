import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, AGING_LABELS } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Building2, DoorOpen, Users, Wallet, AlertTriangle, TrendingUp, ArrowUpRight, ArrowDownRight, Loader2, CheckCircle2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts";

const AGING_COLORS = ["#059669", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#b91c1c"];

function KPI({ label, value, icon: Icon, tone, money = true }) {
  const toneCls = tone === "rose" ? "text-rose-500" : tone === "amber" ? "text-amber-500"
    : tone === "emerald" ? "text-emerald-600" : "text-muted-foreground";
  return (
    <Card className="border-border p-5 shadow-none" data-testid={`kpi-${label}`}>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Icon className={`h-4 w-4 ${toneCls}`} />
      </div>
      <p className="mt-2 font-display text-2xl font-bold tracking-tight tabular-nums">
        {money ? formatCurrency(value) : value}
      </p>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const [condo, setCondo] = useState("all");
  const { data: condos = [] } = useQuery({
    queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["fin-dashboard", condo],
    queryFn: () => api.get("/finance/dashboard", { params: condo !== "all" ? { condominium_id: condo } : {} }).then((r) => r.data),
  });
  const { data: ops } = useQuery({
    queryKey: ["ops-dashboard", condo],
    queryFn: () => api.get("/ops/dashboard", { params: condo !== "all" ? { condominium_id: condo } : {} }).then((r) => r.data),
  });

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  const t = data.totals;

  return (
    <div data-testid="dashboard-page">
      <PageHeader title="Dashboard" subtitle="Visão geral financeira e operacional">
        {user?.role !== "owner" && (
          <Select value={condo} onValueChange={setCondo}>
            <SelectTrigger className="w-[220px]" data-testid="dashboard-condo-filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os condomínios</SelectItem>
              {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPI label="A receber" value={t.receivable} icon={Wallet} tone="amber" />
        <KPI label="Em atraso" value={t.overdue} icon={AlertTriangle} tone="rose" />
        <KPI label="Recebido este mês" value={t.received_month} icon={ArrowUpRight} tone="emerald" />
        <KPI label="Despesas este mês" value={t.expenses_month} icon={ArrowDownRight} tone="rose" />
        <KPI label="Fluxo de caixa (mês)" value={t.cashflow_month} icon={TrendingUp} />
        <KPI label="Total recebido" value={t.total_received} icon={ArrowUpRight} tone="emerald" />
        <KPI label="Frações em dívida" value={t.fractions_in_debt} icon={AlertTriangle} tone="rose" money={false} />
        <KPI label="Frações regularizadas" value={t.fractions_no_debt} icon={CheckCircle2} tone="emerald" money={false} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KPI label="Condomínios" value={t.condominiums} icon={Building2} money={false} />
        <KPI label="Frações" value={t.fractions} icon={DoorOpen} money={false} />
        <KPI label="Condóminos" value={t.owners} icon={Users} money={false} />
        <KPI label="Saldo credor" value={t.credit_balance} icon={Wallet} tone="emerald" />
      </div>

      {ops && (
        <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-7" data-testid="ops-cards">
          <KPI label="Ocorrências abertas" value={ops.open_occurrences} icon={AlertTriangle} tone="amber" money={false} />
          <KPI label="Ocorrências urgentes" value={ops.urgent_occurrences} icon={AlertTriangle} tone="rose" money={false} />
          <KPI label="Manutenção em atraso" value={ops.overdue_maintenance} icon={AlertTriangle} tone="rose" money={false} />
          <KPI label="Manutenção a vencer" value={ops.upcoming_maintenance} icon={CheckCircle2} money={false} />
          <KPI label="Contratos a expirar" value={ops.contracts_expiring} icon={AlertTriangle} tone="amber" money={false} />
          <KPI label="Tarefas pendentes" value={ops.pending_tasks} icon={CheckCircle2} money={false} />
          <KPI label="Assembleias" value={ops.upcoming_assemblies} icon={CheckCircle2} money={false} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border p-5 shadow-none lg:col-span-2" data-testid="chart-income-expense">
          <h3 className="font-display text-sm font-semibold">Receitas, Faturado e Despesas (6 meses)</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="faturado" name="Faturado" fill="#1e293b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="recebido" name="Recebido" fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="despesas" name="Despesas" fill="#e11d48" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="border-border p-5 shadow-none" data-testid="chart-aging">
          <h3 className="font-display text-sm font-semibold">Antiguidade da dívida</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.debt_aging.map((b) => ({ ...b, label: AGING_LABELS[b.bucket] || b.bucket }))} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={70} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="amount" name="Em dívida" radius={[0, 3, 3, 0]}>
                  {data.debt_aging.map((_, i) => <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border p-5 shadow-none lg:col-span-2" data-testid="chart-cashflow">
          <h3 className="font-display text-sm font-semibold">Fluxo de caixa mensal</h3>
          <div className="mt-4 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Line type="monotone" dataKey="fluxo" name="Fluxo" stroke="#2563eb" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="border-border p-5 shadow-none" data-testid="recent-payments">
          <h3 className="mb-3 font-display text-sm font-semibold">Recebimentos recentes</h3>
          {data.recent_payments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Sem recebimentos.</p>
          ) : (
            <div className="divide-y divide-border">
              {data.recent_payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2.5 text-sm">
                  <div>
                    <p className="font-medium">{p.description}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(p.date)}</p>
                  </div>
                  <span className="font-semibold tabular-nums text-emerald-600">{formatCurrency(p.credit || p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
