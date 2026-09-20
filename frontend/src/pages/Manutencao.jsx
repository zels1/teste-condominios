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
import { Wrench, Plus, Loader2, CheckCircle2 } from "lucide-react";

const FREQ = { none: "Pontual", monthly: "Mensal", quarterly: "Trimestral", biannual: "Semestral", annual: "Anual" };

export default function Manutencao() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const empty = { condominium_id: "", supplier_id: "", title: "", category: "Outro", maint_type: "preventive", frequency: "annual", next_date: new Date().toISOString().slice(0, 10), estimated_cost: "" };
  const [form, setForm] = useState(empty);
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/finance/suppliers").then((r) => r.data), enabled: open });
  const { data: items = [], isLoading } = useQuery({ queryKey: ["maintenance"], queryFn: () => api.get("/ops/maintenance").then((r) => r.data) });
  const create = useMutation({
    mutationFn: (p) => api.post("/ops/maintenance", { ...p, supplier_id: p.supplier_id || null, estimated_cost: Number(p.estimated_cost) || 0, next_date: new Date(p.next_date).toISOString() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["maintenance"] }); toast.success("Manutenção agendada."); setOpen(false); setForm(empty); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const complete = useMutation({ mutationFn: (id) => api.post(`/ops/maintenance/${id}/complete`), onSuccess: () => { qc.invalidateQueries({ queryKey: ["maintenance"] }); toast.success("Concluída. Próxima data recalculada."); } });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="manutencao-page">
      <PageHeader title="Manutenção" subtitle="Manutenção preventiva e corretiva">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="add-maintenance-btn"><Plus className="mr-2 h-4 w-4" /> Nova Manutenção</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Nova Manutenção</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="grid grid-cols-2 gap-3" data-testid="maintenance-form">
              <div className="col-span-2 space-y-1.5"><Label>Título *</Label><Input value={form.title} onChange={set("title")} required data-testid="maint-title" /></div>
              <div className="space-y-1.5"><Label>Condomínio *</Label>
                <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v }))}><SelectTrigger data-testid="maint-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Fornecedor</Label>
                <Select value={form.supplier_id} onValueChange={(v) => setForm((f) => ({ ...f, supplier_id: v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Frequência</Label>
                <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v }))}><SelectTrigger data-testid="maint-freq"><SelectValue /></SelectTrigger>
                  <SelectContent>{Object.entries(FREQ).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Próxima data</Label><Input type="date" value={form.next_date} onChange={set("next_date")} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Custo estimado (€)</Label><Input type="number" step="0.01" value={form.estimated_cost} onChange={set("estimated_cost")} /></div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={create.isPending || !form.condominium_id} data-testid="maint-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Agendar</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>
      {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : items.length === 0 ? <EmptyState icon={Wrench} title="Sem manutenções" testid="maint-empty" />
        : <Card className="border-border shadow-none"><Table data-testid="maintenance-table">
            <TableHeader><TableRow><TableHead>Título</TableHead><TableHead>Condomínio</TableHead><TableHead>Frequência</TableHead><TableHead>Próxima</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Ações</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((m) => (
              <TableRow key={m.id} data-testid={`maint-row-${m.id}`}>
                <TableCell className="font-semibold">{m.title}</TableCell><TableCell className="text-muted-foreground">{m.condominium_name}</TableCell>
                <TableCell>{FREQ[m.frequency] || m.frequency}</TableCell><TableCell className="tabular-nums">{formatDate(m.next_date)}</TableCell>
                <TableCell><StatusBadge status={m.status} /></TableCell>
                <TableCell className="text-right"><Button size="sm" variant="outline" className="h-8" onClick={() => complete.mutate(m.id)} data-testid={`maint-complete-${m.id}`}><CheckCircle2 className="mr-1 h-4 w-4" /> Concluir</Button></TableCell>
              </TableRow>))}</TableBody></Table></Card>}
    </div>
  );
}
