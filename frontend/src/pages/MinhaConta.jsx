import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, PAY_METHOD_LABELS } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatementView, openPdf } from "@/components/shared/StatementView";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserCircle, FileDown, Loader2 } from "lucide-react";

export default function MinhaConta() {
  const [fraction, setFraction] = useState("");
  const { data: fractions = [], isLoading } = useQuery({ queryKey: ["my-fractions"], queryFn: () => api.get("/fractions").then((r) => r.data) });
  const { data: payments = [] } = useQuery({ queryKey: ["my-payments"], queryFn: () => api.get("/finance/payments").then((r) => r.data) });

  useEffect(() => {
    if (fractions.length && !fraction) setFraction(fractions[0].id);
  }, [fractions, fraction]);

  if (isLoading) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  return (
    <div data-testid="minha-conta-page">
      <PageHeader title="Minha Conta" subtitle="A sua conta corrente e recebimentos">
        {fraction && (
          <Button variant="outline" onClick={() => openPdf(`/finance/notice/${fraction}`)} data-testid="my-notice-btn">
            <FileDown className="mr-2 h-4 w-4" /> Aviso de Pagamento
          </Button>
        )}
      </PageHeader>

      {fractions.length === 0 ? (
        <EmptyState icon={UserCircle} title="Sem frações associadas" description="A sua conta ainda não tem frações associadas." />
      ) : (
        <>
          {fractions.length > 1 && (
            <Card className="mb-6 border-border p-4 shadow-none">
              <Select value={fraction} onValueChange={setFraction}>
                <SelectTrigger className="sm:w-[280px]" data-testid="my-fraction-select"><SelectValue /></SelectTrigger>
                <SelectContent>{fractions.map((f) => <SelectItem key={f.id} value={f.id}>{f.identifier} — {f.condominium_name}</SelectItem>)}</SelectContent>
              </Select>
            </Card>
          )}

          {fraction && <StatementView fractionId={fraction} />}

          <h3 className="mb-3 mt-8 font-display text-lg font-semibold">Os meus recebimentos</h3>
          {payments.length === 0 ? (
            <EmptyState icon={FileDown} title="Sem recebimentos" />
          ) : (
            <Card className="border-border shadow-none">
              <Table data-testid="my-payments-table">
                <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Recibo</TableHead><TableHead>Método</TableHead><TableHead className="text-right">Montante</TableHead><TableHead className="w-24"></TableHead></TableRow></TableHeader>
                <TableBody>
                  {payments.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="tabular-nums text-muted-foreground">{formatDate(p.date)}</TableCell>
                      <TableCell className="font-semibold">{p.receipt_number}</TableCell>
                      <TableCell className="text-muted-foreground">{PAY_METHOD_LABELS[p.method] || p.method}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-emerald-600">{formatCurrency(p.amount)}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" className="h-8" onClick={() => openPdf(`/finance/payments/${p.id}/receipt`)} data-testid={`my-receipt-${p.id}`}>
                          <FileDown className="mr-1 h-4 w-4" /> Recibo
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
