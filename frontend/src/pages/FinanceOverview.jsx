import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency, AGING_LABELS } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Wallet, AlertTriangle, ArrowUpRight, ArrowDownRight, TrendingUp, Loader2 } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";

function KPI({ label, value, icon: Icon, tone }) {
  const c = tone === "rose" ? "text-rose-500" : tone === "emerald" ? "text-emerald-600" : tone === "amber" ? "text-amber-500" : "text-muted-foreground";
  return (
    <Card className="border-border p-5 shadow-none">
      <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{label}</p><Icon className={`h-4 w-4 ${c}`} /></div>
      <p className="mt-2 font-display text-2xl font-bold tabular-nums">{formatCurrency(value)}</p>
    </Card>
  );
}

export default function FinanceOverview() {
  const [condo, setCondo] = useState("all");
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data, isLoading } = useQuery({
    queryKey: ["fin-overview", condo],
    queryFn: () => api.get("/finance/dashboard", { params: condo !== "all" ? { condominium_id: condo } : {} }).then((r) => r.data),
  });

  if (isLoading || !data) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  const t = data.totals;

  return (
    <div data-testid="finance-overview-page">
      <PageHeader title="Finanças — Visão Geral" subtitle="Resumo financeiro consolidado">
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="w-[220px]" data-testid="fin-condo-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os condomínios</SelectItem>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KPI label="A receber" value={t.receivable} icon={Wallet} tone="amber" />
        <KPI label="Em atraso" value={t.overdue} icon={AlertTriangle} tone="rose" />
        <KPI label="Total recebido" value={t.total_received} icon={ArrowUpRight} tone="emerald" />
        <KPI label="Despesas (total)" value={t.expenses_total} icon={ArrowDownRight} tone="rose" />
        <KPI label="Fluxo mês" value={t.cashflow_month} icon={TrendingUp} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="border-border p-5 shadow-none">
          <h3 className="font-display text-sm font-semibold">Faturado vs Recebido vs Despesas</h3>
          <div className="mt-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.monthly}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="faturado" name="Faturado" fill="#1e293b" radius={[3, 3, 0, 0]} />
                <Bar dataKey="recebido" name="Recebido" fill="#059669" radius={[3, 3, 0, 0]} />
                <Bar dataKey="despesas" name="Despesas" fill="#e11d48" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="border-border shadow-none">
          <div className="border-b border-border px-5 py-3"><h3 className="font-display text-sm font-semibold">Valores a receber por condomínio</h3></div>
          <Table>
            <TableHeader><TableRow><TableHead>Condomínio</TableHead><TableHead className="text-right">A receber</TableHead></TableRow></TableHeader>
            <TableBody>
              {data.outstanding_by_condo.length === 0 ? (
                <TableRow><TableCell colSpan={2} className="py-8 text-center text-muted-foreground">Tudo regularizado.</TableCell></TableRow>
              ) : data.outstanding_by_condo.map((o, i) => (
                <TableRow key={i}><TableCell className="font-medium">{o.name}</TableCell><TableCell className="text-right font-semibold tabular-nums text-rose-600">{formatCurrency(o.valor)}</TableCell></TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
