import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { FolderOpen, Upload, Loader2, FileDown } from "lucide-react";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const CATS = ["Legal", "Financeiro", "Seguro", "Contrato", "Fatura", "Assembleia", "Técnico", "Manutenção", "Correspondência", "Outro"];

export default function Documentos() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [meta, setMeta] = useState({ name: "", category: "Outro", condominium_id: "", file: null });
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: items = [], isLoading } = useQuery({ queryKey: ["documents", search], queryFn: () => api.get("/ops/documents", { params: search ? { search } : {} }).then((r) => r.data) });
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("file", meta.file); fd.append("name", meta.name || meta.file.name);
      fd.append("category", meta.category);
      if (meta.condominium_id) { fd.append("condominium_id", meta.condominium_id); fd.append("related_entity_type", "condominium"); fd.append("related_entity_id", meta.condominium_id); }
      return api.post("/ops/documents", fd);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["documents"] }); toast.success("Documento carregado."); setOpen(false); setMeta({ name: "", category: "Outro", condominium_id: "", file: null }); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  return (
    <div data-testid="documentos-page">
      <PageHeader title="Documentos" subtitle="Gestão documental segura">
        {isStaff && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button data-testid="upload-doc-btn"><Upload className="mr-2 h-4 w-4" /> Carregar</Button></DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle className="font-display">Carregar Documento</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); upload.mutate(); }} className="space-y-3" data-testid="document-form">
                <div className="space-y-1.5"><Label>Ficheiro *</Label><Input type="file" onChange={(e) => setMeta((m) => ({ ...m, file: e.target.files[0] }))} required data-testid="doc-file" /></div>
                <div className="space-y-1.5"><Label>Nome</Label><Input value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} placeholder="(usa o nome do ficheiro)" data-testid="doc-name" /></div>
                <div className="space-y-1.5"><Label>Categoria</Label>
                  <Select value={meta.category} onValueChange={(v) => setMeta((m) => ({ ...m, category: v }))}><SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-1.5"><Label>Condomínio</Label>
                  <Select value={meta.condominium_id} onValueChange={(v) => setMeta((m) => ({ ...m, condominium_id: v }))}><SelectTrigger><SelectValue placeholder="Opcional" /></SelectTrigger>
                    <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select></div>
                <DialogFooter><Button type="submit" disabled={upload.isPending || !meta.file} data-testid="doc-submit">{upload.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Carregar</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>
      <Card className="mb-6 border-border p-4 shadow-none"><Input placeholder="Pesquisar documentos…" value={search} onChange={(e) => setSearch(e.target.value)} className="sm:w-[320px]" data-testid="doc-search" /></Card>
      {isLoading ? <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        : items.length === 0 ? <EmptyState icon={FolderOpen} title="Sem documentos" testid="doc-empty" />
        : <Card className="border-border shadow-none"><Table data-testid="documents-table">
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Categoria</TableHead><TableHead>Tipo</TableHead><TableHead>Carregado</TableHead><TableHead className="text-right">Ação</TableHead></TableRow></TableHeader>
            <TableBody>{items.map((d) => (
              <TableRow key={d.id} data-testid={`doc-row-${d.id}`}>
                <TableCell className="font-semibold">{d.name}</TableCell><TableCell>{d.category}</TableCell>
                <TableCell className="text-muted-foreground">{d.file_name}</TableCell><TableCell className="tabular-nums text-muted-foreground">{formatDate(d.created_at)}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost" className="h-8" onClick={() => window.open(`${BACKEND}/api/ops/documents/${d.id}/download`, "_blank")} data-testid={`doc-download-${d.id}`}><FileDown className="mr-1 h-4 w-4" /> Abrir</Button></TableCell>
              </TableRow>))}</TableBody></Table></Card>}
    </div>
  );
}
