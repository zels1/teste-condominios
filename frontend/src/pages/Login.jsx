import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { formatApiErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building, Loader2 } from "lucide-react";

const BG =
  "https://images.unsplash.com/photo-1750364567724-b3c7cf0642a7?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NzN8MHwxfHNlYXJjaHwzfHxsaXNib24lMjBtb2Rlcm4lMjBhcmNoaXRlY3R1cmUlMjBidWlsZGluZ3xlbnwwfHx8fDE3ODk4NDQ2NDF8MA&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("master.marques@gmail.com");
  const [password, setPassword] = useState("Domvus2025!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await login(email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* Left visual */}
      <div className="relative hidden w-1/2 lg:block">
        <img src={BG} alt="" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-slate-900/65" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-white text-slate-900">
              <Building className="h-5 w-5" />
            </div>
            <span className="font-display text-2xl font-extrabold tracking-tight">DOMVUS</span>
          </div>
          <div>
            <h2 className="font-display text-4xl font-bold leading-tight">
              Gestão profissional de condomínios.
            </h2>
            <p className="mt-4 max-w-md text-base text-white/80">
              Uma plataforma completa para gerir condomínios, frações, condóminos e
              finanças — com rigor, transparência e controlo total.
            </p>
          </div>
          <p className="text-xs text-white/50">© {new Date().getFullYear()} DOMVUS · Portugal</p>
        </div>
      </div>

      {/* Right form */}
      <div className="flex w-full items-center justify-center px-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground">
                <Building className="h-5 w-5" />
              </div>
              <span className="font-display text-2xl font-extrabold tracking-tight">DOMVUS</span>
            </div>
          </div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Iniciar sessão</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Aceda ao seu painel de gestão de condomínios.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-4" data-testid="login-form">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                data-testid="login-email"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Palavra-passe</Label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  data-testid="forgot-password-link"
                >
                  Esqueceu-se?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="login-password"
              />
            </div>
            {error && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="login-error">
                {error}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={loading} data-testid="login-submit">
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Entrar
            </Button>
          </form>

          <div className="mt-6 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">Contas de demonstração</p>
            <p className="mt-1">gestor@domvus.pt · staff@domvus.pt · condomino@domvus.pt</p>
            <p>Palavra-passe: Domvus2025!</p>
          </div>
        </div>
      </div>
    </div>
  );
}
