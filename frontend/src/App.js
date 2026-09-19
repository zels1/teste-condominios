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
import Condominiums from "@/pages/Condominiums";
import CondominiumDetail from "@/pages/CondominiumDetail";
import Fractions from "@/pages/Fractions";
import Owners from "@/pages/Owners";
import Finance from "@/pages/Finance";
import Users from "@/pages/Users";

const SOON = [
  ["/fornecedores", "Fornecedores", "Gestão de fornecedores e prestadores de serviços"],
  ["/recebimentos", "Recebimentos", "Registo e conciliação de recebimentos"],
  ["/despesas", "Despesas", "Registo de despesas e faturas de fornecedores"],
  ["/relatorios", "Relatórios", "Relatórios e demonstrações financeiras"],
  ["/ocorrencias", "Ocorrências", "Gestão de ocorrências e reclamações"],
  ["/manutencao", "Manutenção", "Planeamento e histórico de manutenção"],
  ["/comunicacoes", "Comunicações", "Centro de comunicações com condóminos"],
  ["/assembleias", "Assembleias", "Convocatórias, atas e deliberações"],
  ["/documentos", "Documentos", "Gestão documental do condomínio"],
  ["/definicoes", "Definições", "Configurações da plataforma"],
];

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
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/condominios" element={<Condominiums />} />
              <Route path="/condominios/:id" element={<CondominiumDetail />} />
              <Route path="/fracoes" element={<Fractions />} />
              <Route path="/condominos" element={<Owners />} />
              <Route path="/contas-correntes" element={<Finance />} />
              <Route path="/utilizadores" element={<Users />} />
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
