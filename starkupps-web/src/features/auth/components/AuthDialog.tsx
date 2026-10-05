import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/state";
import { EmailSignInForm, EmailSignUpForm } from "./AuthForms";

type MainTab = "signin" | "signup";

export function AuthDialog({
  open,
  onOpenChange,
  initialTab = "signin",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: MainTab;
}) {
  const { configured, loading } = useAuth();
  const [main, setMain] = useState<MainTab>(initialTab);
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
          `DialogContent` is a bottom sheet below `sm` and a centred dialog above
          it (see dialog.tsx). Only the width cap belongs here; the scroll
          container is the body, so the close button stays reachable.
        */}
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="px-6 pt-8 text-center">
          <p className="eyebrow text-primary">
            {main === "signin" ? "Welcome back" : "Join StarKupps"}
          </p>
          <DialogTitle className="font-display text-2xl">
            {main === "signin" ? "Sign in to StarKupps" : "Create your account"}
          </DialogTitle>
          <DialogDescription>
            {main === "signin"
              ? "Order faster, track pickups, save favourites."
              : "One account for dine-in, takeaway & delivery."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={main} onValueChange={(v) => setMain(v as MainTab)} className="w-full">
          <TabsList className="mx-6 grid w-[calc(100%-3rem)] grid-cols-2 rounded-xl">
            <TabsTrigger value="signin" className="rounded-lg">
              Sign in
            </TabsTrigger>
            <TabsTrigger value="signup" className="rounded-lg">
              Sign up
            </TabsTrigger>
          </TabsList>

          <div className="mt-5 space-y-5 overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            {!loading && !configured && (
              <Alert variant="destructive">
                <AlertDescription>
                  Sign-in isn't configured in this build — set VITE_SUPABASE_URL and
                  VITE_SUPABASE_ANON_KEY in starkupps-web/.env, then restart the dev server.
                </AlertDescription>
              </Alert>
            )}

            {main === "signin" ? (
              <EmailSignInForm onSuccess={close} />
            ) : (
              <>
                <EmailSignUpForm onSuccess={close} onSwitchToLogin={() => setMain("signin")} />
                <p className="text-center text-xs text-muted-foreground">
                  By continuing you agree to our Terms & Privacy Policy.
                </p>
              </>
            )}
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
