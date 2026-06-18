import { useEffect, useState, type ReactNode } from "react";
import { AdminAuthError, clearAdminSecret, getAdminSecret, setAdminSecret } from "@/lib/admin";

type OperatorAuthGateProps = {
  children: ReactNode;
  error?: unknown;
  prompt?: string;
  onSecretChange?: (secret: string | null) => void;
};

export function OperatorAuthGate({
  children,
  error,
  prompt = "輸入管理密碼以檢視營運工具",
  onSecretChange,
}: OperatorAuthGateProps) {
  const [secret, setSecretState] = useState<string | null>(getAdminSecret());
  const [input, setInput] = useState("");

  useEffect(() => {
    if (error instanceof AdminAuthError) {
      clearAdminSecret();
      setSecretState(null);
      onSecretChange?.(null);
    }
  }, [error, onSecretChange]);

  if (!secret) {
    return (
      <div className="mx-auto max-w-sm space-y-3 p-6">
        <h1 className="font-display text-xl font-bold">營運後台</h1>
        <p className="text-sm text-[var(--color-soft-ink)]">{prompt}</p>
        <input
          type="password"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="ADMIN_SECRET"
          className="w-full rounded-[var(--radius)] border-2 border-[var(--color-ink)] p-2"
        />
        <button
          type="button"
          onClick={() => {
            setAdminSecret(input);
            setSecretState(input);
            onSecretChange?.(input);
          }}
          className="block w-full rounded-full border-2 border-[var(--color-ink)] bg-[var(--color-acid)] py-2 font-heading font-bold"
        >
          進入
        </button>
      </div>
    );
  }

  return <>{children}</>;
}
