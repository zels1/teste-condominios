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
import { FileStack, Plus, Loader2 } from "lucide-react";

const CATS = ["Elevador", "Limpeza", "Seguro", "Segurança", "Jardinagem", "Manutenção", "Outro"];

export default function Contratos() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const empty = { condominium_id: "", supplier_id: "", title: "", category: "Manutenção", contract_number: "", start_date: new Date().toISOString().slice(0, 10), end_date: "", value: "", payment_frequency: "annual" };
  const [form, setForm] = useState(empty);
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/finance/suppliers").then((r) => r.data), enabled: open });
  const { data: items = [], isLoading } = useQuery({ queryKey: ["contracts"], queryFn: () => api.get("/ops/contracts").then((r) => r.data) });
  const create = useMutation({
    mutationFn: (p) => api.post("/ops/contracts", { ...p, supplier_id: p.supplier_id || null, value: Number(p.value) || 0, start_date: p.start_date ? new Date(p.start_date).toISOString() : null, end_date: p.end_date ? new Date(p.end_date).toISOString() : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["contracts"] }); toast.success("Contrato criado."); setOpen(false); setForm(empty); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="contratos-page">
      <PageHeader title="Contratos" subtitle="Contratos de serviços e seguros">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="add-contract-btn"><Plus className="mr-2 h-4 w-4" /> Novo Contrato</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Novo Contrato</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="grid grid-cols-2 gap-3" data-testid="contract-form">
              <div className="col-span-2 space-y-1.5"><Label>Título *</Label><Input value={form.title} onChange={set("title")} required data-testid="contract-title" /></div>
              <div className="space-y-1.5"><Label>Condomínio *</Label>
                <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v }))}><SelectTrigger data-testid="contract-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Fornecedor</Label>
                <Select value={form.supplier_id} onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Valor (€)</Label><Input type="number" step="0.01" value={form.value} onChange={set("value")} /></div>
              <div className="space-y-1.5"><Label>Início</Label><Input type="date" value={form.start_date} onChange={set("start_date")} /></div>
              <div className="space-y-1.5"><Label>Fim</Label><Input type="date" value={form.end_date} onChange={set("end_date")} data-testid="contract-end" /></div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={create.isPending || !form.condominium_id} data-testid="contract-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>
      {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : items.length === 0 ? <EmptyState icon={FileStack} title="Sem contratos" testid="contract-empty" />
        : <Card className="border-border shadow-none"><Table data-testid="contracts-table">
            <TableHeader><TableRow><TableHead>Título</TableHead><TableHead>Condomínio</TableHead><TableHead>Fornecedor</TableHead><TableHead>Fim</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Estado</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((c) => (
              <TableRow key={c.id} data-testid={`contract-row-${c.id}`}>
                <TableCell className="font-semibold">{c.title}</TableCell><TableCell className="text-muted-foreground">{c.condominium_name}</TableCell>
                <TableCell>{c.supplier_name || "—"}</TableCell><TableCell className="tabular-nums">{formatDate(c.end_date)}{c.days_to_expiry != null && c.days_to_expiry >= 0 && c.days_to_expiry <= 90 ? ` (${c.days_to_expiry}d)` : ""}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(c.value)}</TableCell><TableCell><StatusBadge status={c.status} /></TableCell>
              </TableRow>))}</TableBody></Table></Card>}
    </div>
  );
}
