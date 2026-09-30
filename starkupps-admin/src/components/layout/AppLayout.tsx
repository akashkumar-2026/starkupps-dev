import { type StaffRole, type View } from "@/config/navigation";
import { SidebarInset } from "@/components/ui/sidebar";
import { cn } from "@/utils/cn";
import { AppHeader } from "./AppHeader";
import { AppSidebar } from "./AppSidebar";

type AppLayoutProps = {
  currentView: View;
  role: StaffRole;
  userName: string;
  activeShiftName: string | null;
  onNavigate: (href: string) => void;
  onLogout: () => void;
  children: React.ReactNode;
};

export function AppLayout({
  currentView,
  role,
  userName,
  activeShiftName,
  onNavigate,
  onLogout,
  children,
}: AppLayoutProps) {
  return (
    <div className="flex min-h-svh w-full bg-[#F4F0E9]">
      <AppSidebar
        currentView={currentView}
        role={role}
        userName={userName}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />
      <SidebarInset className="flex min-h-svh flex-1 flex-col bg-[#F4F0E9]">
        <AppHeader
          currentView={currentView}
          activeShiftName={activeShiftName}
        />
        <main className={cn("flex-1 p-4 md:p-6 lg:p-8", "bg-[#F4F0E9]")}>
          {children}
        </main>
        <footer className="border-t border-[#E4DCD1] bg-[#F4F0E9] px-6 py-3 text-center font-mono-ledger text-[10px] uppercase tracking-[0.12em] text-[#8B7E71]">
          StarKupps Operations • {new Date().getFullYear()}
        </footer>
      </SidebarInset>
    </div>
  );
}

// Re-export for convenience
export { AppHeader } from "./AppHeader";
export { AppSidebar } from "./AppSidebar";
