import { NavLink } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, Building2, DoorOpen, Users, Truck,
  Wallet, Receipt, TrendingUp, FileBarChart,
  AlertTriangle, Wrench, Megaphone, Gavel,
  FolderOpen, UserCog, Settings, Building,
} from "lucide-react";

const GROUPS = [
  {
    label: null,
    items: [{ to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", testid: "nav-dashboard" }],
  },
  {
    label: "Gestão",
    items: [
      { to: "/condominios", icon: Building2, label: "Condomínios", testid: "nav-condominios" },
      { to: "/fracoes", icon: DoorOpen, label: "Frações", testid: "nav-fracoes" },
      { to: "/condominos", icon: Users, label: "Condóminos", testid: "nav-condominos" },
      { to: "/fornecedores", icon: Truck, label: "Fornecedores", testid: "nav-fornecedores", soon: true },
    ],
  },
  {
    label: "Finanças",
    items: [
      { to: "/contas-correntes", icon: Wallet, label: "Contas Correntes", testid: "nav-contas" },
      { to: "/recebimentos", icon: Receipt, label: "Recebimentos", testid: "nav-recebimentos", soon: true },
      { to: "/despesas", icon: TrendingUp, label: "Despesas", testid: "nav-despesas", soon: true },
      { to: "/relatorios", icon: FileBarChart, label: "Relatórios", testid: "nav-relatorios", soon: true },
    ],
  },
  {
    label: "Operações",
    items: [
      { to: "/ocorrencias", icon: AlertTriangle, label: "Ocorrências", testid: "nav-ocorrencias", soon: true },
      { to: "/manutencao", icon: Wrench, label: "Manutenção", testid: "nav-manutencao", soon: true },
      { to: "/comunicacoes", icon: Megaphone, label: "Comunicações", testid: "nav-comunicacoes", soon: true },
      { to: "/assembleias", icon: Gavel, label: "Assembleias", testid: "nav-assembleias", soon: true },
    ],
  },
  {
    label: "Documentos",
    items: [{ to: "/documentos", icon: FolderOpen, label: "Documentos", testid: "nav-documentos", soon: true }],
  },
  {
    label: "Administração",
    items: [
      { to: "/utilizadores", icon: UserCog, label: "Utilizadores", testid: "nav-utilizadores", staffOnly: true },
      { to: "/definicoes", icon: Settings, label: "Definições", testid: "nav-definicoes", soon: true },
    ],
  },
];

export default function Sidebar({ onNavigate }) {
  const { isStaff } = useAuth();

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card" data-testid="sidebar">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <Building className="h-5 w-5" />
        </div>
        <span className="font-display text-xl font-extrabold tracking-tight">DOMVUS</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {GROUPS.map((group, gi) => {
          const items = group.items.filter((it) => !it.staffOnly || isStaff);
          if (!items.length) return null;
          return (
            <div key={gi} className="mb-5">
              {group.label && (
                <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </p>
              )}
              <div className="space-y-0.5">
                {items.map((it) => (
                  <NavLink
                    key={it.to}
                    to={it.to}
                    onClick={onNavigate}
                    data-testid={it.testid}
                    className={({ isActive }) =>
                      `group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground/70 hover:bg-muted hover:text-foreground"
                      }`
                    }
                  >
                    <it.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                    <span className="flex-1 truncate">{it.label}</span>
                    {it.soon && (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground group-[.bg-primary]:bg-primary-foreground/20">
                        Em breve
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
