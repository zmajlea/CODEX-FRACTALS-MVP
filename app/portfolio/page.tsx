import { redirect } from "next/navigation";

export default function PortfolioRedirect() {
  redirect("/switchboard?results=1");
}
