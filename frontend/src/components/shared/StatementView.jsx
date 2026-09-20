import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, FIN_TX_LABELS } from "@/lib/format";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2 } from "lucide-react";

const BACKEND = process.env.REACT_APP_BACKEND_URL;

export function openPdf(path) {
  window.open(`${BACKEND}/api${path}`, "_blank");
}

export function StatementView({ fractionId }) {
  const { data, isLoading } = useQuery({
    queryKey: ["statement", fractionId],
    queryFn: () => api.get(`/finance/statement/${fractionId}`).then((r) => r.data),
    enabled: !!fractionId,
  });

  if (!fractionId) return null;
  if (isLoading || !data) {
    return <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div data-testid="statement-view">
      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card className="border-border p-4 shadow-none">
          <p className="text-sm text-muted-foreground">Fração</p>
          <p className="font-display text-xl font-bold">{data.fraction.identifier}</p>
          <p className="text-xs text-muted-foreground">{data.owner.name}</p>
        </Card>
        <Card className="border-border p-4 shadow-none">
          <p className="text-sm text-muted-foreground">Saldo</p>
          <p className={`font-display text-xl font-bold tabular-nums ${data.balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
            {formatCurrency(data.balance)}
          </p>
        </Card>
        <Card className="border-border p-4 shadow-none">
          <p className="text-sm text-muted-foreground">Em dívida</p>
          <p className="font-display text-xl font-bold tabular-nums text-rose-600">{formatCurrency(data.outstanding)}</p>
        </Card>
        <Card className="border-border p-4 shadow-none">
          <p className="text-sm text-muted-foreground">Crédito</p>
          <p className="font-display text-xl font-bold tabular-nums text-emerald-600">{formatCurrency(data.credit)}</p>
        </Card>
      </div>

      <Card className="border-border shadow-none">
        <Table data-testid="statement-table">
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead className="text-right">Débito</TableHead>
              <TableHead className="text-right">Crédito</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead className="text-right">Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="py-10 text-center text-muted-foreground">Sem movimentos.</TableCell></TableRow>
            ) : data.rows.map((r) => (
              <TableRow key={r.id} data-testid={`stmt-row-${r.id}`}>
                <TableCell className="tabular-nums text-muted-foreground">{formatDate(r.date)}</TableCell>
                <TableCell className="font-medium">
                  {r.description}
                  {r.reversed && <span className="ml-2 text-xs text-muted-foreground">(revertido)</span>}
                </TableCell>
                <TableCell className="text-xs font-semibold">{FIN_TX_LABELS[r.transaction_type]}</TableCell>
                <TableCell className="text-right tabular-nums text-rose-600">{r.debit > 0 ? formatCurrency(r.debit) : "—"}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600">{r.credit > 0 ? formatCurrency(r.credit) : "—"}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(r.balance)}</TableCell>
                <TableCell className="text-right">{r.status ? <StatusBadge status={r.status} /> : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
