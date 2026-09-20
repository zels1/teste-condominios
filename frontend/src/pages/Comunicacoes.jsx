import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
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
import { Megaphone, Plus, Loader2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";

export default function Comunicacoes() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ condominium_id: "", subject: "", message: "" });
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: templates = [] } = useQuery({ queryKey: ["templates"], queryFn: () => api.get("/ops/communication-templates").then((r) => r.data), enabled: open });
  const { data: items = [], isLoading } = useQuery({ queryKey: ["communications"], queryFn: () => api.get("/ops/communications").then((r) => r.data) });
  const send = useMutation({
    mutationFn: () => api.post("/ops/communications", { ...form, target_type: "condominium", type: "email", status: "sent" }),
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["communications"] }); toast.success(`Enviada para ${r.data.recipient_count} condómino(s). ${r.data.delivery_note || ""}`); setOpen(false); setForm({ condominium_id: "", subject: "", message: "" }); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const applyTemplate = (t) => setForm((f) => ({ ...f, subject: t.subject, message: t.body }));

  return (
    <div data-testid="comunicacoes-page">
      <PageHeader title="Comunicações" subtitle={isStaff ? "Mensagens aos condóminos" : "Avisos e comunicados do seu condomínio"}>
        {isStaff && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="compose-btn"><Plus className="mr-2 h-4 w-4" /> Nova Comunicação</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Nova Comunicação</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }} className="space-y-3" data-testid="communication-form">
              <div className="space-y-1.5"><Label>Condomínio (todos os condóminos) *</Label>
                <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v }))}><SelectTrigger data-testid="comm-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                  <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Modelo</Label>
                <Select onValueChange={(v) => applyTemplate(templates.find((t) => t.id === v))}><SelectTrigger data-testid="comm-template"><SelectValue placeholder="Aplicar modelo (opcional)" /></SelectTrigger>
                  <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-1.5"><Label>Assunto *</Label><Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} required data-testid="comm-subject" /></div>
              <div className="space-y-1.5"><Label>Mensagem *</Label><Textarea rows={6} value={form.message} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} required data-testid="comm-message" /></div>
              <DialogFooter><Button type="submit" disabled={send.isPending || !form.condominium_id} data-testid="comm-submit">{send.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Enviar</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
        )}
      </PageHeader>
      {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : items.length === 0 ? <EmptyState icon={Megaphone} title="Sem comunicações" testid="comm-empty" />
        : <Card className="border-border shadow-none"><Table data-testid="communications-table">
            <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Assunto</TableHead><TableHead>Condomínio</TableHead>{isStaff && <TableHead className="text-right">Destinatários</TableHead>}<TableHead>Estado</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((c) => (
              <TableRow key={c.id} data-testid={`comm-row-${c.id}`}>
                <TableCell className="tabular-nums text-muted-foreground">{formatDateTime(c.created_at)}</TableCell>
                <TableCell className="font-semibold">{c.subject}</TableCell><TableCell className="text-muted-foreground">{c.condominium_name}</TableCell>
                {isStaff && <TableCell className="text-right tabular-nums">{c.recipient_count}</TableCell>}<TableCell><StatusBadge status={c.status === "sent" ? "confirmado" : c.status} label={c.status === "sent" ? "Enviada" : "Rascunho"} /></TableCell>
              </TableRow>))}</TableBody></Table></Card>}
    </div>
  );
}
