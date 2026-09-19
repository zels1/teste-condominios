import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Users, Plus, Loader2 } from "lucide-react";

export default function Owners() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const empty = { condominium_id: "", name: "", nif: "", email: "", phone: "", address: "" };
  const [form, setForm] = useState(empty);

  const { data: condos = [] } = useQuery({
    queryKey: ["condos"],
    queryFn: () => api.get("/condominiums").then((r) => r.data),
  });
  const { data: owners = [], isLoading } = useQuery({
    queryKey: ["owners-list", filter],
    queryFn: () =>
      api.get("/owners", { params: filter !== "all" ? { condominium_id: filter } : {} })
        .then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (p) => api.post("/owners", p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owners-list"] });
      toast.success("Condómino criado.");
      setOpen(false);
      setForm(empty);
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="owners-page">
      <PageHeader title="Condóminos" subtitle="Proprietários das frações">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px]" data-testid="owners-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os condomínios</SelectItem>
            {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {isStaff && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="add-owner-btn"><Plus className="mr-2 h-4 w-4" /> Novo Condómino</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="font-display">Novo Condómino</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="grid grid-cols-2 gap-3" data-testid="owner-form">
                <div className="col-span-2 space-y-1.5">
                  <Label>Condomínio *</Label>
                  <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v }))}>
                    <SelectTrigger data-testid="owner-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Nome *</Label>
                  <Input value={form.name} onChange={set("name")} required data-testid="owner-name" />
                </div>
                <div className="space-y-1.5"><Label>NIF</Label><Input value={form.nif} onChange={set("nif")} /></div>
                <div className="space-y-1.5"><Label>Telefone</Label><Input value={form.phone} onChange={set("phone")} /></div>
                <div className="col-span-2 space-y-1.5"><Label>Email</Label><Input type="email" value={form.email} onChange={set("email")} /></div>
                <div className="col-span-2 space-y-1.5"><Label>Morada</Label><Input value={form.address} onChange={set("address")} /></div>
                <DialogFooter className="col-span-2 mt-2">
                  <Button type="submit" disabled={create.isPending || !form.condominium_id} data-testid="owner-submit">
                    {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar Condómino
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : owners.length === 0 ? (
        <EmptyState icon={Users} title="Sem condóminos" description="Ainda não existem condóminos registados." testid="owners-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="owners-table">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Condomínio</TableHead>
                <TableHead>Contacto</TableHead>
                <TableHead className="text-right">Frações</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {owners.map((o) => (
                <TableRow key={o.id} data-testid={`owner-row-${o.id}`}>
                  <TableCell className="font-semibold">{o.name}</TableCell>
                  <TableCell className="text-muted-foreground">{o.condominium_name}</TableCell>
                  <TableCell className="text-muted-foreground">{o.email || o.phone || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{o.fraction_count}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${o.balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {formatCurrency(o.balance)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
