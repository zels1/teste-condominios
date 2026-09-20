import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { ROLE_LABELS, formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import Sidebar from "./Sidebar";
import { LogOut, Menu, User, Bell } from "lucide-react";

function NotificationBell() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api.get("/ops/notifications").then((r) => r.data),
    refetchInterval: 30000,
  });
  const readAll = useMutation({
    mutationFn: () => api.post("/ops/notifications/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const items = data?.items || [];
  const unread = data?.unread || 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" data-testid="notif-bell">
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white" data-testid="notif-count">
              {unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="p-0">Notificações</DropdownMenuLabel>
          {unread > 0 && <button className="text-xs text-muted-foreground hover:text-foreground" onClick={() => readAll.mutate()} data-testid="notif-read-all">Marcar todas lidas</button>}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">Sem notificações.</p>
        ) : items.slice(0, 8).map((n) => (
          <div key={n.id} className={`px-3 py-2 text-sm ${!n.read_at ? "bg-muted/40" : ""}`} data-testid={`notif-${n.id}`}>
            <p className="font-medium">{n.title}</p>
            <p className="text-xs text-muted-foreground">{n.message}</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">{formatDateTime(n.created_at)}</p>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function Topbar() {
  const { user, logout } = useAuth();
  const initials = (user?.name || "?").split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur-md md:px-6">
      <div className="flex items-center gap-3">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" data-testid="mobile-menu-btn"><Menu className="h-5 w-5" /></Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0"><Sidebar /></SheetContent>
        </Sheet>
        <div className="hidden text-sm text-muted-foreground md:block">
          {user?.role === "owner" ? "Portal do Condómino" : "Painel de Gestão"}
        </div>
      </div>

      <div className="flex items-center gap-1">
        <NotificationBell />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="gap-2 px-2" data-testid="user-menu-trigger">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{initials}</span>
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-sm font-medium">{user?.name}</span>
                <span className="block text-xs text-muted-foreground">{ROLE_LABELS[user?.role] || user?.role}</span>
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex items-center gap-2"><User className="h-4 w-4" /> {user?.email}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={logout} data-testid="logout-btn" className="text-destructive"><LogOut className="mr-2 h-4 w-4" /> Terminar sessão</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
