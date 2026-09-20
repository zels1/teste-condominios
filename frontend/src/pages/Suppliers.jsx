import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Truck, Plus, Loader2 } from "lucide-react";

export default function Suppliers() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const empty = { name: "", nif: "", contact_person: "", email: "", phone: "", address: "", iban: "", services: "" };
  const [form, setForm] = useState(empty);

  const { data: suppliers = [], isLoading } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/finance/suppliers").then((r) => r.data) });
  const create = useMutation({
    mutationFn: (p) => api.post("/finance/suppliers", p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["suppliers"] }); toast.success("Fornecedor criado."); setOpen(false); setForm(empty); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="suppliers-page">
      <PageHeader title="Fornecedores" subtitle="Prestadores de serviços dos condomínios">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button data-testid="add-supplier-btn"><Plus className="mr-2 h-4 w-4" /> Novo Fornecedor</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle className="font-display">Novo Fornecedor</DialogTitle></DialogHeader>
            <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="grid grid-cols-2 gap-3" data-testid="supplier-form">
              <div className="col-span-2 space-y-1.5"><Label>Nome *</Label><Input value={form.name} onChange={set("name")} required data-testid="sup-name" /></div>
              <div className="space-y-1.5"><Label>NIF</Label><Input value={form.nif} onChange={set("nif")} /></div>
              <div className="space-y-1.5"><Label>Pessoa de contacto</Label><Input value={form.contact_person} onChange={set("contact_person")} /></div>
              <div className="space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={set("email")} /></div>
              <div className="space-y-1.5"><Label>Telefone</Label><Input value={form.phone} onChange={set("phone")} /></div>
              <div className="col-span-2 space-y-1.5"><Label>Serviços</Label><Input value={form.services} onChange={set("services")} placeholder="ex: Limpeza, Elevadores" /></div>
              <div className="space-y-1.5"><Label>IBAN</Label><Input value={form.iban} onChange={set("iban")} /></div>
              <div className="space-y-1.5"><Label>Morada</Label><Input value={form.address} onChange={set("address")} /></div>
              <DialogFooter className="col-span-2"><Button type="submit" disabled={create.isPending} data-testid="sup-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar Fornecedor</Button></DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : suppliers.length === 0 ? (
        <EmptyState icon={Truck} title="Sem fornecedores" description="Registe o primeiro fornecedor." testid="sup-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="suppliers-table">
            <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>NIF</TableHead><TableHead>Serviços</TableHead><TableHead>Email</TableHead><TableHead>Telefone</TableHead></TableRow></TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id} data-testid={`supplier-row-${s.id}`}>
                  <TableCell className="font-semibold">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">{s.nif || "—"}</TableCell>
                  <TableCell>{s.services || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{s.email || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{s.phone || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
