import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Gavel, Plus, Loader2 } from "lucide-react";

export default function Assembleias() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ condominium_id: "", date: "", time: "18:30", location: "", assembly_type: "ordinary", agendaText: "Aprovação da ata anterior\nAprovação de contas\nAprovação do orçamento" });
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: items = [], isLoading } = useQuery({ queryKey: ["assemblies"], queryFn: () => api.get("/ops/assemblies").then((r) => r.data) });
  const create = useMutation({
    mutationFn: () => api.post("/ops/assemblies", {
      condominium_id: form.condominium_id, date: form.date, time: form.time, location: form.location,
      assembly_type: form.assembly_type, agenda: form.agendaText.split("\n").filter(Boolean).map((t) => ({ title: t, description: "" })),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["assemblies"] }); toast.success("Assembleia agendada."); setOpen(false); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  return (
    <div data-testid="assembleias-page">
      <PageHeader title="Assembleias" subtitle="Convocatórias e ordens de trabalhos">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="add-assembly-btn"><Plus className="mr-2 h-4 w-4" /> Nova Assembleia</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Nova Assembleia</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="grid grid-cols-2 gap-3" data-testid="assembly-form">
              <div className="col-span-2 space-y-1.5"><Label>Condomínio *</Label>
                <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v }))}><SelectTrigger data-testid="assembly-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Data *</Label><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required data-testid="assembly-date" /></div>
              <div className="space-y-1.5"><Label>Hora</Label><Input value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></div>
              <div className="space-y-1.5"><Label>Tipo</Label>
                <Select value={form.assembly_type} onValueChange={(v) => setForm((f) => ({ ...f, assembly_type: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="ordinary">Ordinária</SelectItem><SelectItem value="extraordinary">Extraordinária</SelectItem></SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Local</Label><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Ordem de trabalhos (uma por linha)</Label><Textarea rows={4} value={form.agendaText} onChange={(e) => setForm((f) => ({ ...f, agendaText: e.target.value }))} /></div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={create.isPending || !form.condominium_id || !form.date} data-testid="assembly-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Agendar</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>
      {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : items.length === 0 ? <EmptyState icon={Gavel} title="Sem assembleias" testid="assembly-empty" />
        : <div className="grid grid-cols-1 gap-4 md:grid-cols-2">{items.map((a) => (
            <Card key={a.id} className="border-border p-5 shadow-none" data-testid={`assembly-card-${a.id}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-base font-semibold">{a.condominium_name}</h3><StatusBadge status={a.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{formatDate(a.date)} · {a.time} · {a.assembly_type === "ordinary" ? "Ordinária" : "Extraordinária"} · {a.location || "—"}</p>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">{(a.agenda || []).map((it, i) => <li key={i}>{it.title}</li>)}</ol>
            </Card>))}</div>}
    </div>
  );
}
