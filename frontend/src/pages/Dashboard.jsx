import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Building2, DoorOpen, Users, Wallet, AlertTriangle, TrendingUp, ArrowDownRight, Loader2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from "recharts";

const KPIS = [
  { key: "condominiums", label: "Condomínios", icon: Building2, money: false },
  { key: "fractions", label: "Frações", icon: DoorOpen, money: false },
  { key: "owners", label: "Condóminos", icon: Users, money: false },
  { key: "receivable", label: "Valor a receber", icon: Wallet, money: true, tone: "amber" },
  { key: "overdue", label: "Em dívida", icon: AlertTriangle, money: true, tone: "rose" },
  { key: "income_month", label: "Recebido este mês", icon: TrendingUp, money: true, tone: "emerald" },
];

const AGING_COLORS = ["#059669", "#f59e0b", "#f97316", "#e11d48"];

export default function Dashboard() {
  const [condo, setCondo] = useState("all");
  const { data: condos = [] } = useQuery({
    queryKey: ["condos"],
    queryFn: () => api.get("/condominiums").then((r) => r.data),
  });
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", condo],
    queryFn: () =>
      api
        .get("/dashboard", { params: condo !== "all" ? { condominium_id: condo } : {} })
        .then((r) => r.data),
  });

  if (isLoading || !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const t = data.totals;

  return (
    <div data-testid="dashboard-page">
      <PageHeader title="Dashboard" subtitle="Visão geral da atividade e finanças">
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="w-[220px]" data-testid="dashboard-condo-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os condomínios</SelectItem>
            {condos.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        {KPIS.map((k) => (
          <Card key={k.key} className="border-border p-5 shadow-none" data-testid={`kpi-${k.key}`}>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{k.label}</p>
              <k.icon className={`h-4 w-4 ${
                k.tone === "rose" ? "text-rose-500" :
                k.tone === "amber" ? "text-amber-500" :
                k.tone === "emerald" ? "text-emerald-600" : "text-muted-foreground"
              }`} />
            </div>
            <p className="mt-2 font-display text-2xl font-bold tracking-tight tabular-nums xl:text-2xl">
              {k.money ? formatCurrency(t[k.key]) : t[k.key]}
            </p>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border p-5 shadow-none lg:col-span-2" data-testid="chart-cashflow">
          <h3 className="font-display text-sm font-semibold">Faturado vs. Recebido (6 meses)</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="faturado" name="Faturado" fill="#1e293b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="recebido" name="Recebido" fill="#059669" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="border-border p-5 shadow-none" data-testid="chart-aging">
          <h3 className="font-display text-sm font-semibold">Antiguidade da dívida</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.debt_aging} layout="vertical" margin={{ left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="bucket" tick={{ fontSize: 12 }} width={48} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="valor" name="Em dívida" radius={[0, 3, 3, 0]}>
                  {data.debt_aging.map((_, i) => (
                    <Cell key={i} fill={AGING_COLORS[i % AGING_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="border-border p-5 shadow-none lg:col-span-2" data-testid="chart-flow">
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
                  <span className="font-semibold tabular-nums text-emerald-600">
                    {formatCurrency(p.amount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
