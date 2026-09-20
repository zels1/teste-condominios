import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, PAY_METHOD_LABELS } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { PaymentDialog } from "@/components/shared/PaymentDialog";
import { openPdf } from "@/components/shared/StatementView";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Receipt, Plus, Loader2, FileDown } from "lucide-react";

export default function Recebimentos() {
  const [condo, setCondo] = useState("all");
  const [payOpen, setPayOpen] = useState(false);
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ["payments", condo],
    queryFn: () => api.get("/finance/payments", { params: condo !== "all" ? { condominium_id: condo } : {} }).then((r) => r.data),
  });

  return (
    <div data-testid="recebimentos-page">
      <PageHeader title="Recebimentos" subtitle="Pagamentos registados e recibos">
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="w-[200px]" data-testid="rec-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os condomínios</SelectItem>
            {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button onClick={() => setPayOpen(true)} data-testid="add-payment-btn"><Plus className="mr-2 h-4 w-4" /> Registar Recebimento</Button>
      </PageHeader>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : payments.length === 0 ? (
        <EmptyState icon={Receipt} title="Sem recebimentos" description="Ainda não há pagamentos registados." testid="rec-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="payments-table">
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead><TableHead>Recibo</TableHead><TableHead>Condomínio</TableHead>
                <TableHead>Fração</TableHead><TableHead>Método</TableHead>
                <TableHead className="text-right">Montante</TableHead><TableHead className="text-right">Crédito</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.map((p) => (
                <TableRow key={p.id} data-testid={`payment-row-${p.id}`}>
                  <TableCell className="tabular-nums text-muted-foreground">{formatDate(p.date)}</TableCell>
                  <TableCell className="font-semibold">{p.receipt_number}</TableCell>
                  <TableCell className="text-muted-foreground">{p.condominium_name}</TableCell>
                  <TableCell>{p.fraction_identifier}</TableCell>
                  <TableCell className="text-muted-foreground">{PAY_METHOD_LABELS[p.method] || p.method}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-emerald-600">{formatCurrency(p.amount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.credit_remaining > 0 ? formatCurrency(p.credit_remaining) : "—"}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" className="h-8" onClick={() => openPdf(`/finance/payments/${p.id}/receipt`)} data-testid={`receipt-btn-${p.id}`}>
                      <FileDown className="mr-1 h-4 w-4" /> Recibo
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} condos={condos} />
    </div>
  );
}
