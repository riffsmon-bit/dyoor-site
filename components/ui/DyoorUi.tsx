import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type Tone = "idle" | "success" | "warning" | "danger" | "busy";

function joinClasses(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

export function PageShell({
  children,
  className = "",
  size = "default",
}: HTMLAttributes<HTMLElement> & { size?: "narrow" | "default" | "wide" }) {
  const width = size === "wide" ? "max-w-[90rem]" : size === "narrow" ? "max-w-6xl" : "max-w-7xl";
  return <main className={joinClasses("mx-auto px-5 py-10", width, "page-enter", className)}>{children}</main>;
}

export function Card({ children, className = "", strong = false, hover = false, ...props }: HTMLAttributes<HTMLDivElement> & { strong?: boolean; hover?: boolean }) {
  return (
    <section {...props} className={joinClasses(strong ? "glass-panel-strong" : "glass-panel", hover && "hover-lift", className)}>
      {children}
    </section>
  );
}

export function SectionHeader({
  actions,
  copy,
  eyebrow,
  title,
  className = "",
}: {
  actions?: ReactNode;
  copy?: ReactNode;
  eyebrow?: string;
  title: string;
  className?: string;
}) {
  return (
    <div className={joinClasses("mb-5 flex flex-col justify-between gap-4 md:flex-row md:items-end", className)}>
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 className="heading-gradient mt-3 text-3xl sm:text-4xl md:text-6xl">{title}</h1>
        {copy && <p className="mt-4 max-w-3xl text-sm font-semibold leading-7 text-white/66 md:text-base">{copy}</p>}
      </div>
      {actions}
    </div>
  );
}

export function Button({
  children,
  className = "",
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const variantClass = variant === "primary" ? "btn-primary" : variant === "ghost" ? "btn-ghost" : "btn-secondary";
  return (
    <button className={joinClasses(variantClass, className)} type="button" {...props}>
      {children}
    </button>
  );
}

export function StatCard({ label, value, className = "" }: { label: string; value: ReactNode; className?: string }) {
  return (
    <div className={joinClasses("glass-panel hover-lift min-w-0 overflow-hidden p-4", className)}>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-white/45">{label}</p>
      <p className="mt-2 max-w-full overflow-hidden text-2xl font-black leading-tight text-white md:text-3xl">{value}</p>
    </div>
  );
}

export function Alert({ children, tone = "idle", className = "" }: HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  const toneClass = {
    idle: "border-white/14 bg-white/[0.035] text-white/66",
    success: "border-emerald-300/35 bg-emerald-300/10 text-emerald-100 energy-pulse",
    warning: "border-yellow-300/35 bg-yellow-300/10 text-yellow-100",
    danger: "border-red-400/40 bg-red-400/10 text-red-100",
    busy: "border-dyoor-cyan/40 bg-dyoor-cyan/10 text-dyoor-cyan",
  }[tone];
  return <div className={joinClasses("status-signal", toneClass, className)}>{children}</div>;
}

export function LoadingSkeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={joinClasses("grid gap-3", className)} aria-label="Loading">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className={joinClasses("skeleton-line h-4", index === lines - 1 && "w-2/3")} />
      ))}
    </div>
  );
}

export function EmptyState({
  action,
  copy,
  title,
  className = "",
}: {
  action?: ReactNode;
  copy: ReactNode;
  title: string;
  className?: string;
}) {
  return (
    <div className={joinClasses("terminal-panel grid place-items-center p-6 text-center", className)}>
      <div>
        <p className="eyebrow">Signal Empty</p>
        <h3 className="mt-2 text-2xl font-black uppercase text-white">{title}</h3>
        <p className="mx-auto mt-3 max-w-md text-sm font-semibold leading-6 text-white/58">{copy}</p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}
