import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ROLE_LABELS, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card } from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { UserCog, Loader2 } from "lucide-react";

export default function Users() {
  const { data: users = [], isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.get("/users").then((r) => r.data),
  });

  return (
    <div data-testid="users-page">
      <PageHeader title="Utilizadores" subtitle="Contas com acesso à plataforma" />
      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : users.length === 0 ? (
        <EmptyState icon={UserCog} title="Sem utilizadores" testid="users-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="users-table">
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Criado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                  <TableCell className="font-semibold">{u.name}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>{ROLE_LABELS[u.role] || u.role}</TableCell>
                  <TableCell>
                    <span className={`text-xs font-semibold ${u.active === false ? "text-rose-600" : "text-emerald-600"}`}>
                      {u.active === false ? "Inativo" : "Ativo"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
