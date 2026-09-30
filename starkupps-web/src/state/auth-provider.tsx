/**
 * Global authentication state.
 *
 * Wraps Supabase Auth and exposes a narrow, typed surface to the app. When the
 * build has no Supabase configuration the provider still mounts and reports
 * `configured: false`, so the UI can show a clear setup message instead of
 * crashing.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";

import { getSupabaseClient } from "@/api/supabase";
import { checkPassword, isValidEmail, notConfiguredError } from "@/features/auth/validation";

export type AuthContextValue = {
  /** `false` when Supabase credentials are missing from this build. */
  configured: boolean;
  loading: boolean;
  session: Session | null;
  user: User | null;
  signUpWithEmail: (args: {
    name: string;
    email: string;
    password: string;
  }) => Promise<{ needsVerification: boolean }>;
  signInWithEmail: (args: { email: string; password: string }) => Promise<void>;
  signOut: () => Promise<void>;
  updateName: (name: string) => Promise<void>;
  /** Send a password-reset link to the address (recovery flow). */
  resetPasswordForEmail: (email: string) => Promise<void>;
  /** Set a new password — after a recovery link, or for a signed-in user. */
  updatePassword: (password: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const client = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    if (!client) {
      setLoading(false);
      return;
    }

    let active = true;

    void client.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: subscription } = client.auth.onAuthStateChange((_event, nextSession) => {
      if (active) setSession(nextSession);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [client]);

  const signUpWithEmail = useCallback(
    async ({ name, email, password }: { name: string; email: string; password: string }) => {
      if (!client) throw notConfiguredError();
      if (!isValidEmail(email)) throw new Error("Enter a valid email address.");

      const passwordCheck = checkPassword(password);
      if (!passwordCheck.ok) throw new Error(passwordCheck.reason);

      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: name.trim() },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (error) throw error;

      // With email confirmation enabled there is no session yet — the customer
      // must verify via the emailed link before they can sign in.
      return { needsVerification: data.session === null };
    },
    [client],
  );

  const signInWithEmail = useCallback(
    async ({ email, password }: { email: string; password: string }) => {
      if (!client) throw notConfiguredError();
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
    },
    [client],
  );

  const resetPasswordForEmail = useCallback(
    async (email: string) => {
      if (!client) throw notConfiguredError();
      if (!isValidEmail(email)) throw new Error("Enter a valid email address.");
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/auth/update-password`,
      });
      if (error) throw error;
    },
    [client],
  );

  const updatePassword = useCallback(
    async (password: string) => {
      if (!client) throw notConfiguredError();
      const passwordCheck = checkPassword(password);
      if (!passwordCheck.ok) throw new Error(passwordCheck.reason);
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
    },
    [client],
  );

  const signOut = useCallback(async () => {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }, [client]);

  const updateName = useCallback(
    async (name: string) => {
      if (!client) throw notConfiguredError();
      const { error } = await client.auth.updateUser({ data: { full_name: name.trim() } });
      if (error) throw error;
    },
    [client],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      configured: client !== null,
      loading,
      session,
      user: session?.user ?? null,
      signUpWithEmail,
      signInWithEmail,
      signOut,
      updateName,
      resetPasswordForEmail,
      updatePassword,
    }),
    [
      client,
      loading,
      session,
      signUpWithEmail,
      signInWithEmail,
      signOut,
      updateName,
      resetPasswordForEmail,
      updatePassword,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}
