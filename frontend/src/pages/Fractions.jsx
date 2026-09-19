import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
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
import { DoorOpen, Plus, Loader2 } from "lucide-react";

export default function Fractions() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const empty = {
    condominium_id: "", identifier: "", block: "", floor: "", door: "",
    fraction_type: "habitacao", owner_id: "", permillage: "",
    monthly_fee: "", reserve_fund: "",
  };
  const [form, setForm] = useState(empty);

  const { data: condos = [] } = useQuery({
    queryKey: ["condos"],
    queryFn: () => api.get("/condominiums").then((r) => r.data),
  });
  const { data: owners = [] } = useQuery({
    queryKey: ["owners", form.condominium_id],
    queryFn: () =>
      api.get("/owners", { params: form.condominium_id ? { condominium_id: form.condominium_id } : {} })
        .then((r) => r.data),
    enabled: open,
  });
  const { data: fractions = [], isLoading } = useQuery({
    queryKey: ["fractions", filter],
    queryFn: () =>
      api.get("/fractions", { params: filter !== "all" ? { condominium_id: filter } : {} })
        .then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (p) =>
      api.post("/fractions", {
        ...p,
        owner_id: p.owner_id || null,
        permillage: Number(p.permillage) || 0,
        monthly_fee: Number(p.monthly_fee) || 0,
        reserve_fund: Number(p.reserve_fund) || 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fractions"] });
      toast.success("Fração criada.");
      setOpen(false);
      setForm(empty);
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="fractions-page">
      <PageHeader title="Frações" subtitle="Unidades autónomas dos condomínios">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px]" data-testid="fractions-filter">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os condomínios</SelectItem>
            {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {isStaff && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="add-fraction-btn"><Plus className="mr-2 h-4 w-4" /> Nova Fração</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="font-display">Nova Fração</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}
                className="grid grid-cols-2 gap-3" data-testid="fraction-form">
                <div className="col-span-2 space-y-1.5">
                  <Label>Condomínio *</Label>
                  <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v, owner_id: "" }))}>
                    <SelectTrigger data-testid="fraction-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Identificador *</Label>
                  <Input value={form.identifier} onChange={set("identifier")} required placeholder="ex: A101" data-testid="fraction-identifier" />
                </div>
                <div className="space-y-1.5">
                  <Label>Bloco</Label>
                  <Input value={form.block} onChange={set("block")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Piso</Label>
                  <Input value={form.floor} onChange={set("floor")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Porta</Label>
                  <Input value={form.door} onChange={set("door")} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Condómino</Label>
                  <Select value={form.owner_id} onValueChange={(v) => setForm((f) => ({ ...f, owner_id: v }))}>
                    <SelectTrigger data-testid="fraction-owner"><SelectValue placeholder="Selecionar (opcional)" /></SelectTrigger>
                    <SelectContent>
                      {owners.map((o) => <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Permilagem (‰)</Label>
                  <Input type="number" step="0.01" value={form.permillage} onChange={set("permillage")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Quota mensal (€)</Label>
                  <Input type="number" step="0.01" value={form.monthly_fee} onChange={set("monthly_fee")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Fundo Reserva (€)</Label>
                  <Input type="number" step="0.01" value={form.reserve_fund} onChange={set("reserve_fund")} />
                </div>
                <DialogFooter className="col-span-2 mt-2">
                  <Button type="submit" disabled={create.isPending || !form.condominium_id} data-testid="fraction-submit">
                    {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar Fração
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : fractions.length === 0 ? (
        <EmptyState icon={DoorOpen} title="Sem frações" description="Ainda não existem frações registadas." testid="fractions-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="fractions-table">
            <TableHeader>
              <TableRow>
                <TableHead>Fração</TableHead>
                <TableHead>Condomínio</TableHead>
                <TableHead>Bloco/Piso</TableHead>
                <TableHead>Condómino</TableHead>
                <TableHead className="text-right">Quota</TableHead>
                <TableHead className="text-right">Saldo</TableHead>
                <TableHead className="text-right">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fractions.map((f) => (
                <TableRow key={f.id} data-testid={`fraction-row-${f.id}`}>
                  <TableCell className="font-semibold">{f.identifier}</TableCell>
                  <TableCell className="text-muted-foreground">{f.condominium_name}</TableCell>
                  <TableCell className="text-muted-foreground">{[f.block, f.floor].filter(Boolean).join(" / ") || "—"}</TableCell>
                  <TableCell>{f.owner_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(f.monthly_fee)}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${f.balance > 0 ? "text-rose-600" : "text-emerald-600"}`}>
                    {formatCurrency(f.balance)}
                  </TableCell>
                  <TableCell className="text-right"><StatusBadge status={f.payment_status} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
