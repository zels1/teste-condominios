import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency, AGING_LABELS } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CheckCircle2, Loader2 } from "lucide-react";

export default function Dividas() {
  const [condo, setCondo] = useState("all");
  const params = condo !== "all" ? { condominium_id: condo } : {};
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: aging } = useQuery({ queryKey: ["aging", condo], queryFn: () => api.get("/finance/aging", { params }).then((r) => r.data) });
  const { data: debts = [], isLoading } = useQuery({ queryKey: ["debts", condo], queryFn: () => api.get("/finance/debts", { params }).then((r) => r.data) });

  return (
    <div data-testid="dividas-page">
      <PageHeader title="Dívidas" subtitle="Valores em dívida e antiguidade">
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="w-[200px]" data-testid="debt-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os condomínios</SelectItem>
            {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </PageHeader>

      {aging && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
          {aging.buckets.map((b) => (
            <Card key={b.bucket} className="border-border p-3 shadow-none" data-testid={`aging-${b.bucket}`}>
              <p className="text-xs text-muted-foreground">{AGING_LABELS[b.bucket] || b.bucket}</p>
              <p className={`mt-1 font-display text-lg font-bold tabular-nums ${b.amount > 0 ? "text-rose-600" : ""}`}>{formatCurrency(b.amount)}</p>
            </Card>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : debts.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="Sem dívidas" description="Todas as frações estão regularizadas." testid="debt-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="debts-table">
            <TableHeader>
              <TableRow>
                <TableHead>Fração</TableHead><TableHead>Condomínio</TableHead><TableHead>Condómino</TableHead>
                <TableHead className="text-right">Dias em atraso</TableHead><TableHead className="text-right">Saldo devedor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {debts.map((d) => (
                <TableRow key={d.fraction_id} data-testid={`debt-row-${d.fraction_id}`}>
                  <TableCell className="font-semibold">{d.fraction_identifier}</TableCell>
                  <TableCell className="text-muted-foreground">{d.condominium_name}</TableCell>
                  <TableCell>{d.owner_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{d.days_overdue}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-rose-600">{formatCurrency(d.balance)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
