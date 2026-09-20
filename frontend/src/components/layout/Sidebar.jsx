import { NavLink } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import {
  LayoutDashboard, Building2, DoorOpen, Users, Truck,
  Wallet, BookOpen, FileStack, Receipt, AlertTriangle, TrendingUp, PieChart, FileBarChart,
  Wrench, Megaphone, Gavel, FolderOpen, UserCog, Settings, Building, UserCircle,
} from "lucide-react";

const STAFF_GROUPS = [
  { label: null, items: [{ to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", testid: "nav-dashboard" }] },
  {
    label: "Gestão",
    items: [
      { to: "/condominios", icon: Building2, label: "Condomínios", testid: "nav-condominios" },
      { to: "/fracoes", icon: DoorOpen, label: "Frações", testid: "nav-fracoes" },
      { to: "/condominos", icon: Users, label: "Condóminos", testid: "nav-condominos" },
      { to: "/fornecedores", icon: Truck, label: "Fornecedores", testid: "nav-fornecedores" },
    ],
  },
  {
    label: "Finanças",
    items: [
      { to: "/financas", icon: Wallet, label: "Visão Geral", testid: "nav-financas" },
      { to: "/contas-correntes", icon: BookOpen, label: "Conta Corrente", testid: "nav-contas" },
      { to: "/quotas", icon: FileStack, label: "Quotas", testid: "nav-quotas" },
      { to: "/recebimentos", icon: Receipt, label: "Recebimentos", testid: "nav-recebimentos" },
      { to: "/dividas", icon: AlertTriangle, label: "Dívidas", testid: "nav-dividas" },
      { to: "/despesas", icon: TrendingUp, label: "Despesas", testid: "nav-despesas" },
      { to: "/orcamento", icon: PieChart, label: "Orçamento", testid: "nav-orcamento" },
      { to: "/relatorios", icon: FileBarChart, label: "Relatórios", testid: "nav-relatorios" },
    ],
  },
  {
    label: "Operações",
    items: [
      { to: "/ocorrencias", icon: AlertTriangle, label: "Ocorrências", testid: "nav-ocorrencias" },
      { to: "/manutencao", icon: Wrench, label: "Manutenção", testid: "nav-manutencao" },
      { to: "/contratos", icon: FileStack, label: "Contratos", testid: "nav-contratos" },
      { to: "/comunicacoes", icon: Megaphone, label: "Comunicações", testid: "nav-comunicacoes" },
      { to: "/assembleias", icon: Gavel, label: "Assembleias", testid: "nav-assembleias" },
      { to: "/tarefas", icon: Wrench, label: "Tarefas", testid: "nav-tarefas" },
    ],
  },
  { label: "Documentos", items: [{ to: "/documentos", icon: FolderOpen, label: "Documentos", testid: "nav-documentos" }] },
  {
    label: "Administração",
    items: [
      { to: "/utilizadores", icon: UserCog, label: "Utilizadores", testid: "nav-utilizadores" },
      { to: "/definicoes", icon: Settings, label: "Definições", testid: "nav-definicoes", soon: true },
    ],
  },
];

const OWNER_GROUPS = [
  { label: null, items: [{ to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", testid: "nav-dashboard" }] },
  {
    label: "A minha área",
    items: [
      { to: "/minha-conta", icon: UserCircle, label: "Minha Conta", testid: "nav-minha-conta" },
      { to: "/ocorrencias", icon: AlertTriangle, label: "Ocorrências", testid: "nav-ocorrencias" },
      { to: "/documentos", icon: FolderOpen, label: "Documentos", testid: "nav-documentos" },
    ],
  },
];

export default function Sidebar({ onNavigate }) {
  const { user } = useAuth();
  const groups = user?.role === "owner" ? OWNER_GROUPS : STAFF_GROUPS;

  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-card" data-testid="sidebar">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary text-primary-foreground">
          <Building className="h-5 w-5" />
        </div>
        <span className="font-display text-xl font-extrabold tracking-tight">DOMVUS</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group, gi) => (
          <div key={gi} className="mb-5">
            {group.label && (
              <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((it) => (
                <NavLink
                  key={it.to}
                  to={it.to}
                  onClick={onNavigate}
                  data-testid={it.testid}
                  className={({ isActive }) =>
                    `group flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors ${
                      isActive ? "bg-primary text-primary-foreground"
                               : "text-foreground/70 hover:bg-muted hover:text-foreground"
                    }`
                  }
                >
                  <it.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.soon && (
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase text-muted-foreground">
                      Em breve
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  );
}
