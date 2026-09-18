"use client";

import type { ReactNode } from "react";
import { useIdleTimeout } from "@/lib/auth/useIdleTimeout";

type Props = {
  loginUrl: string;
  children: ReactNode;
};

/** Thin client wrapper so server layouts can mount B32 idle timeout. */
export function IdleTimeoutProvider({ loginUrl, children }: Props) {
  useIdleTimeout({ loginUrl });
  return <>{children}</>;
}
