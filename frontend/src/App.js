import "@/App.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider } from "@/context/AuthContext";
import ProtectedRoute from "@/components/ProtectedRoute";
import AppLayout from "@/components/layout/AppLayout";
import ComingSoon from "@/components/shared/ComingSoon";

import Login from "@/pages/Login";
import ForgotPassword from "@/pages/ForgotPassword";
import ResetPassword from "@/pages/ResetPassword";
import Dashboard from "@/pages/Dashboard";
import OwnerDashboard from "@/pages/OwnerDashboard";
import { useAuth } from "@/context/AuthContext";
import Condominiums from "@/pages/Condominiums";
import CondominiumDetail from "@/pages/CondominiumDetail";
import Fractions from "@/pages/Fractions";
import Owners from "@/pages/Owners";
import Users from "@/pages/Users";
import Suppliers from "@/pages/Suppliers";
import FinanceOverview from "@/pages/FinanceOverview";
import ContaCorrente from "@/pages/ContaCorrente";
import Quotas from "@/pages/Quotas";
import Recebimentos from "@/pages/Recebimentos";
import Dividas from "@/pages/Dividas";
import Despesas from "@/pages/Despesas";
import Orcamento from "@/pages/Orcamento";
import Relatorios from "@/pages/Relatorios";
import MinhaConta from "@/pages/MinhaConta";
import Ocorrencias from "@/pages/Ocorrencias";
import OcorrenciaDetail from "@/pages/OcorrenciaDetail";
import Manutencao from "@/pages/Manutencao";
import Contratos from "@/pages/Contratos";
import Comunicacoes from "@/pages/Comunicacoes";
import Assembleias from "@/pages/Assembleias";
import Documentos from "@/pages/Documentos";
import Tarefas from "@/pages/Tarefas";

const SOON = [
  ["/definicoes", "Definições", "Configurações da plataforma"],
];

function DashboardRouter() {
  const { user } = useAuth();
  return user?.role === "owner" ? <OwnerDashboard /> : <Dashboard />;
}

function App() {
  return (
    <div className="App">
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />

            <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
              <Route path="/dashboard" element={<DashboardRouter />} />
              <Route path="/condominios" element={<Condominiums />} />
              <Route path="/condominios/:id" element={<CondominiumDetail />} />
              <Route path="/fracoes" element={<Fractions />} />
              <Route path="/condominos" element={<Owners />} />
              <Route path="/fornecedores" element={<Suppliers />} />
              <Route path="/financas" element={<FinanceOverview />} />
              <Route path="/contas-correntes" element={<ContaCorrente />} />
              <Route path="/quotas" element={<Quotas />} />
              <Route path="/recebimentos" element={<Recebimentos />} />
              <Route path="/dividas" element={<Dividas />} />
              <Route path="/despesas" element={<Despesas />} />
              <Route path="/orcamento" element={<Orcamento />} />
              <Route path="/relatorios" element={<Relatorios />} />
              <Route path="/utilizadores" element={<Users />} />
              <Route path="/minha-conta" element={<MinhaConta />} />
              <Route path="/ocorrencias" element={<Ocorrencias />} />
              <Route path="/ocorrencias/:id" element={<OcorrenciaDetail />} />
              <Route path="/manutencao" element={<Manutencao />} />
              <Route path="/contratos" element={<Contratos />} />
              <Route path="/comunicacoes" element={<Comunicacoes />} />
              <Route path="/assembleias" element={<Assembleias />} />
              <Route path="/documentos" element={<Documentos />} />
              <Route path="/tarefas" element={<Tarefas />} />
              {SOON.map(([path, title, sub]) => (
                <Route key={path} path={path} element={<ComingSoon title={title} subtitle={sub} />} />
              ))}
            </Route>

            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
        <Toaster position="top-right" richColors />
      </AuthProvider>
    </div>
  );
}

export default App;
