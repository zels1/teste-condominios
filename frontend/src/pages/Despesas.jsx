import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { TrendingUp, Plus, Loader2 } from "lucide-react";

const CATEGORIES = ["Eletricidade", "Água", "Limpeza", "Elevador", "Seguro", "Manutenção", "Jardinagem", "Reparações", "Administração", "Despesas bancárias", "Outro"];

export default function Despesas() {
  const qc = useQueryClient();
  const [condo, setCondo] = useState("all");
  const [open, setOpen] = useState(false);
  const empty = { condominium_id: "", supplier_id: "", supplier_name: "", description: "", category: "Manutenção", amount: "", vat: "", invoice_number: "", payment_status: "pendente", date: new Date().toISOString().slice(0, 10) };
  const [form, setForm] = useState(empty);

  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/finance/suppliers").then((r) => r.data), enabled: open });
  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ["expenses", condo],
    queryFn: () => api.get("/finance/expenses", { params: condo !== "all" ? { condominium_id: condo } : {} }).then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (p) => api.post("/finance/expenses", { ...p, amount: Number(p.amount) || 0, vat: Number(p.vat) || 0, date: new Date(p.date).toISOString() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["expenses"] }); toast.success("Despesa registada."); setOpen(false); setForm(empty); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="despesas-page">
      <PageHeader title="Despesas" subtitle="Faturas e despesas dos condomínios">
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="w-[200px]" data-testid="exp-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os condomínios</SelectItem>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="add-expense-btn"><Plus className="mr-2 h-4 w-4" /> Nova Despesa</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Nova Despesa</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="grid grid-cols-2 gap-3" data-testid="expense-form">
              <div className="col-span-2 space-y-1.5">
                <Label>Condomínio *</Label>
                <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v }))}>
                  <SelectTrigger data-testid="exp-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Fornecedor</Label>
                <Select value={form.supplier_id} onValueChange={(v) => { const s = suppliers.find((x) => x.id === v); setForm((f) => ({ ...f, supplier_id: v, supplier_name: s?.name || "" })); }}>
                  <SelectTrigger data-testid="exp-supplier"><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="exp-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2 space-y-1.5"><Label>Descrição</Label><Input value={form.description} onChange={set("description")} /></div>
              <div className="space-y-1.5"><Label>Montante (€) *</Label><Input type="number" step="0.01" value={form.amount} onChange={set("amount")} required data-testid="exp-amount" /></div>
              <div className="space-y-1.5"><Label>IVA (€)</Label><Input type="number" step="0.01" value={form.vat} onChange={set("vat")} /></div>
              <div className="space-y-1.5"><Label>Nº Fatura</Label><Input value={form.invoice_number} onChange={set("invoice_number")} /></div>
              <div className="space-y-1.5"><Label>Data</Label><Input type="date" value={form.date} onChange={set("date")} /></div>
              <div className="col-span-2 space-y-1.5">
                <Label>Estado</Label>
                <Select value={form.payment_status} onValueChange={(v) => setForm((f) => ({ ...f, payment_status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="pendente">Pendente</SelectItem><SelectItem value="pago">Pago</SelectItem></SelectContent>
                </Select>
              </div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={create.isPending || !form.condominium_id} data-testid="exp-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registar Despesa</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : expenses.length === 0 ? (
        <EmptyState icon={TrendingUp} title="Sem despesas" description="Registe a primeira despesa." testid="exp-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="expenses-table">
            <TableHeader>
              <TableRow><TableHead>Data</TableHead><TableHead>Condomínio</TableHead><TableHead>Fornecedor</TableHead><TableHead>Categoria</TableHead><TableHead>Fatura</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-right">Estado</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {expenses.map((e) => (
                <TableRow key={e.id} data-testid={`expense-row-${e.id}`}>
                  <TableCell className="tabular-nums text-muted-foreground">{formatDate(e.date)}</TableCell>
                  <TableCell className="text-muted-foreground">{e.condominium_name}</TableCell>
                  <TableCell>{e.supplier_name || "—"}</TableCell>
                  <TableCell>{e.category}</TableCell>
                  <TableCell className="text-muted-foreground">{e.invoice_number || "—"}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(e.total)}</TableCell>
                  <TableCell className="text-right"><StatusBadge status={e.payment_status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
