import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Building, Loader2, ArrowLeft } from "lucide-react";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") || "";
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      toast.success("Palavra-passe redefinida com sucesso.");
      navigate("/login");
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <Building className="h-5 w-5" />
          </div>
          <span className="font-display text-2xl font-extrabold tracking-tight">DOMVUS</span>
        </div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Nova palavra-passe</h1>
        <p className="mt-1 text-sm text-muted-foreground">Defina a sua nova palavra-passe.</p>
        <form onSubmit={submit} className="mt-8 space-y-4" data-testid="reset-form">
          <div className="space-y-1.5">
            <Label htmlFor="password">Palavra-passe</Label>
            <Input id="password" type="password" value={password} required minLength={6}
              onChange={(e) => setPassword(e.target.value)} data-testid="reset-password" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading || !token} data-testid="reset-submit">
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Redefinir
          </Button>
          {!token && <p className="text-sm text-destructive">Link inválido.</p>}
        </form>
        <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar ao início de sessão
        </Link>
      </div>
    </div>
  );
}
