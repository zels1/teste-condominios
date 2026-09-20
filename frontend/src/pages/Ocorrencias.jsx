import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { AlertTriangle, Plus, Loader2 } from "lucide-react";

export const OCC_CATEGORIES = ["Water", "Electricity", "Lift", "Plumbing", "Construction", "Cleaning", "Gardening", "Security", "Access", "Insurance", "Noise", "Other"];
export const CAT_PT = { Water: "Água", Electricity: "Eletricidade", Lift: "Elevador", Plumbing: "Canalização", Construction: "Construção", Cleaning: "Limpeza", Gardening: "Jardinagem", Security: "Segurança", Access: "Acessos", Insurance: "Seguro", Noise: "Ruído", Other: "Outro" };

export default function Ocorrencias() {
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [fCondo, setFCondo] = useState("all");
  const [fStatus, setFStatus] = useState("all");
  const empty = { condominium_id: "", fraction_id: "", title: "", description: "", category: "Other", priority: "normal", location: "" };
  const [form, setForm] = useState(empty);

  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: fractions = [] } = useQuery({ queryKey: ["frac", form.condominium_id], queryFn: () => api.get("/fractions", { params: { condominium_id: form.condominium_id } }).then((r) => r.data), enabled: open && !!form.condominium_id });
  const params = {}; if (fCondo !== "all") params.condominium_id = fCondo; if (fStatus !== "all") params.status = fStatus;
  const { data: items = [], isLoading } = useQuery({ queryKey: ["occurrences", fCondo, fStatus], queryFn: () => api.get("/ops/occurrences", { params }).then((r) => r.data) });

  const create = useMutation({
    mutationFn: (p) => api.post("/ops/occurrences", { ...p, fraction_id: p.fraction_id || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["occurrences"] }); toast.success("Ocorrência criada."); setOpen(false); setForm(empty); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="ocorrencias-page">
      <PageHeader title="Ocorrências" subtitle="Incidentes e pedidos dos condomínios">
        <Select value={fStatus} onValueChange={setFStatus}>
          <SelectTrigger className="w-[160px]" data-testid="occ-status-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os estados</SelectItem>{["new","assigned","in_progress","waiting_supplier","resolved","closed"].map((s) => <SelectItem key={s} value={s}><StatusBadge status={s} /></SelectItem>)}</SelectContent>
        </Select>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="add-occurrence-btn"><Plus className="mr-2 h-4 w-4" /> Nova Ocorrência</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Nova Ocorrência</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="grid grid-cols-2 gap-3" data-testid="occurrence-form">
              <div className="col-span-2 space-y-1.5"><Label>Título *</Label><Input value={form.title} onChange={set("title")} required data-testid="occ-title" /></div>
              <div className="space-y-1.5"><Label>Condomínio *</Label>
                <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v, fraction_id: "" }))}>
                  <SelectTrigger data-testid="occ-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Fração</Label>
                <Select value={form.fraction_id} onValueChange={(v) => setForm((f) => ({ ...f, fraction_id: v }))} disabled={!form.condominium_id}>
                  <SelectTrigger data-testid="occ-fraction"><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>{fractions.map((f) => <SelectItem key={f.id} value={f.id}>{f.identifier}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Categoria</Label>
                <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                  <SelectTrigger data-testid="occ-category"><SelectValue /></SelectTrigger>
                  <SelectContent>{OCC_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{CAT_PT[c]}</SelectItem>)}</SelectContent>
                </Select></div>
              <div className="space-y-1.5"><Label>Prioridade</Label>
                <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}>
                  <SelectTrigger data-testid="occ-priority"><SelectValue /></SelectTrigger>
                  <SelectContent>{["low","normal","high","urgent"].map((p) => <SelectItem key={p} value={p}><StatusBadge status={p} /></SelectItem>)}</SelectContent>
                </Select></div>
              <div className="col-span-2 space-y-1.5"><Label>Localização</Label><Input value={form.location} onChange={set("location")} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Descrição</Label><Textarea value={form.description} onChange={set("description")} /></div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={create.isPending || !form.condominium_id || !form.title} data-testid="occ-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : items.length === 0 ? <EmptyState icon={AlertTriangle} title="Sem ocorrências" description="Ainda não há ocorrências registadas." testid="occ-empty" />
        : (
        <Card className="border-border shadow-none">
          <Table data-testid="occurrences-table">
            <TableHeader><TableRow><TableHead>Título</TableHead><TableHead>Condomínio</TableHead><TableHead>Categoria</TableHead><TableHead>Prioridade</TableHead><TableHead>Estado</TableHead><TableHead className="text-right">Criada</TableHead></TableRow></TableHeader>
            <TableBody>
              {items.map((o) => (
                <TableRow key={o.id} className="cursor-pointer" onClick={() => nav(`/ocorrencias/${o.id}`)} data-testid={`occ-row-${o.id}`}>
                  <TableCell className="font-semibold">{o.title}</TableCell>
                  <TableCell className="text-muted-foreground">{o.condominium_name}</TableCell>
                  <TableCell>{CAT_PT[o.category] || o.category}</TableCell>
                  <TableCell><StatusBadge status={o.priority} /></TableCell>
                  <TableCell><StatusBadge status={o.status} /></TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatDate(o.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
