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
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ClipboardList, Plus, Loader2 } from "lucide-react";

const STATUSES = ["todo", "in_progress", "waiting", "completed", "cancelled"];

export default function Tarefas() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState(false);
  const [form, setForm] = useState({ title: "", priority: "normal", due_date: "", condominium_id: "" });
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: items = [], isLoading } = useQuery({ queryKey: ["tasks", mine], queryFn: () => api.get("/ops/tasks", { params: mine ? { mine: true } : {} }).then((r) => r.data) });
  const create = useMutation({
    mutationFn: () => api.post("/ops/tasks", { ...form, condominium_id: form.condominium_id || null, due_date: form.due_date ? new Date(form.due_date).toISOString() : null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); toast.success("Tarefa criada."); setOpen(false); setForm({ title: "", priority: "normal", due_date: "", condominium_id: "" }); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const upd = useMutation({ mutationFn: ({ id, status }) => api.put(`/ops/tasks/${id}`, { status }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["tasks"] }); } });

  return (
    <div data-testid="tarefas-page">
      <PageHeader title="Tarefas" subtitle="Gestão de tarefas operacionais">
        <Button variant={mine ? "default" : "outline"} onClick={() => setMine((v) => !v)} data-testid="my-tasks-toggle">As minhas</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="add-task-btn"><Plus className="mr-2 h-4 w-4" /> Nova Tarefa</Button></DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle className="font-display">Nova Tarefa</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3" data-testid="task-form">
              <div className="space-y-1.5"><Label>Título *</Label><Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required data-testid="task-title" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Prioridade</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm((f) => ({ ...f, priority: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{["low","normal","high","urgent"].map((p) => <SelectItem key={p} value={p}><StatusBadge status={p} /></SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>Prazo</Label><Input type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} data-testid="task-due" /></div>
              </div>
              <div className="space-y-1.5"><Label>Condomínio</Label>
                <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                  <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <DialogFooter><Button type="submit" disabled={create.isPending || !form.title} data-testid="task-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>
      {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : items.length === 0 ? <EmptyState icon={ClipboardList} title="Sem tarefas" testid="task-empty" />
        : <Card className="border-border shadow-none"><Table data-testid="tasks-table">
            <TableHeader><TableRow><TableHead>Tarefa</TableHead><TableHead>Condomínio</TableHead><TableHead>Prioridade</TableHead><TableHead>Prazo</TableHead><TableHead className="w-[160px]">Estado</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((t) => (
              <TableRow key={t.id} data-testid={`task-row-${t.id}`}>
                <TableCell className="font-semibold">{t.title}</TableCell><TableCell className="text-muted-foreground">{t.condominium_name || "—"}</TableCell>
                <TableCell><StatusBadge status={t.priority} /></TableCell><TableCell className="tabular-nums">{t.due_date ? formatDate(t.due_date) : "—"}</TableCell>
                <TableCell>
                  <Select value={t.status} onValueChange={(v) => upd.mutate({ id: t.id, status: v })}>
                    <SelectTrigger className="h-8" data-testid={`task-status-${t.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}><StatusBadge status={s} /></SelectItem>)}</SelectContent>
                  </Select>
                </TableCell>
              </TableRow>))}</TableBody></Table></Card>}
    </div>
  );
}
