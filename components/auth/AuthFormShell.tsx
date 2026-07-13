"use client";

import Link from "next/link";
import type { ReactNode } from "react";

type Props = {
  title: string;
  subtitle: string;
  backHref?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthFormShell({
  title,
  subtitle,
  backHref = "/",
  children,
  footer,
}: Props) {
  return (
    <main className="auth-page">
      <Link href={backHref} className="auth-back">
        ← Back
      </Link>

      <div className="auth-card">
        <h1 className="auth-title">{title}</h1>
        <p className="text-center text-sm text-slate-600 mb-6">{subtitle}</p>
        {children}
        {footer}
      </div>
    </main>
  );
}
