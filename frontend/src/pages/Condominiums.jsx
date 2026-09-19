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
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Building2, Plus, Loader2, ChevronRight } from "lucide-react";

const EMPTY = {
  name: "", address: "", postal_code: "", city: "", nif: "",
  num_blocks: 1, bank_name: "", iban: "", property_manager: "",
  status: "ativo", notes: "",
};

export default function Condominiums() {
  const { isStaff } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const { data: condos = [], isLoading } = useQuery({
    queryKey: ["condos"],
    queryFn: () => api.get("/condominiums").then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (payload) =>
      api.post("/condominiums", {
        ...payload,
        num_blocks: Number(payload.num_blocks) || 1,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["condos"] });
      toast.success("Condomínio criado.");
      setOpen(false);
      setForm(EMPTY);
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="condominiums-page">
      <PageHeader title="Condomínios" subtitle="Edifícios sob gestão">
        {isStaff && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="add-condominium-btn">
                <Plus className="mr-2 h-4 w-4" /> Novo Condomínio
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle className="font-display">Novo Condomínio</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => { e.preventDefault(); create.mutate(form); }}
                className="grid grid-cols-2 gap-3"
                data-testid="condominium-form"
              >
                <div className="col-span-2 space-y-1.5">
                  <Label>Nome *</Label>
                  <Input value={form.name} onChange={set("name")} required data-testid="condo-name" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Morada</Label>
                  <Input value={form.address} onChange={set("address")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Código Postal</Label>
                  <Input value={form.postal_code} onChange={set("postal_code")} placeholder="0000-000" />
                </div>
                <div className="space-y-1.5">
                  <Label>Cidade</Label>
                  <Input value={form.city} onChange={set("city")} />
                </div>
                <div className="space-y-1.5">
                  <Label>NIF</Label>
                  <Input value={form.nif} onChange={set("nif")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Nº de Blocos</Label>
                  <Input type="number" min="1" value={form.num_blocks} onChange={set("num_blocks")} />
                </div>
                <div className="space-y-1.5">
                  <Label>Banco</Label>
                  <Input value={form.bank_name} onChange={set("bank_name")} />
                </div>
                <div className="space-y-1.5">
                  <Label>IBAN</Label>
                  <Input value={form.iban} onChange={set("iban")} />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Gestor responsável</Label>
                  <Input value={form.property_manager} onChange={set("property_manager")} />
                </div>
                <DialogFooter className="col-span-2 mt-2">
                  <Button type="submit" disabled={create.isPending} data-testid="condo-submit">
                    {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Criar Condomínio
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : condos.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="Sem condomínios"
          description="Comece por criar o primeiro condomínio sob gestão."
          testid="condos-empty"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {condos.map((c) => (
            <Card
              key={c.id}
              onClick={() => navigate(`/condominios/${c.id}`)}
              className="group cursor-pointer border-border p-5 shadow-none transition-colors hover:bg-muted/50"
              data-testid={`condo-card-${c.id}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/5 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <StatusBadge status={c.status} />
              </div>
              <h3 className="mt-3 font-display text-base font-semibold leading-tight">{c.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {[c.address, c.city].filter(Boolean).join(", ") || "Sem morada"}
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
                <span className="text-muted-foreground">
                  {c.fraction_count} {c.fraction_count === 1 ? "fração" : "frações"} · {c.num_blocks} bloco(s)
                </span>
                <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
