import Link from "next/link";
import { logout } from "@/app/actions";
import { GearIcon } from "./icons";

type Tab = "sooz" | "personal" | "outreach" | "settings";

export default function Header({
  active,
  subtitle,
  badges = {},
}: {
  active: Tab;
  subtitle: string;
  badges?: Partial<Record<"sooz" | "personal" | "outreach", number>>;
}) {
  const tabs: { key: "sooz" | "personal" | "outreach"; label: string; href: string }[] = [
    { key: "sooz", label: "Sooz", href: "/?section=sooz" },
    { key: "personal", label: "Personal", href: "/?section=personal" },
    { key: "outreach", label: "Outreach", href: "/outreach" },
  ];
  return (
    <>
      <header className="title-row">
        <div>
          <h1 className="large-title">{active === "settings" ? "Settings" : "Query"}</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="title-actions">
          <Link className="icon-btn" href="/settings" aria-label="Settings" aria-current={active === "settings" ? "page" : undefined}>
            <GearIcon size={20} />
          </Link>
          <form action={logout}>
            <button className="text-btn">Sign out</button>
          </form>
        </div>
      </header>

      <div className="toolbar">
        <div className="toolbar-inner">
          <nav className="seg large" aria-label="Section">
            {tabs.map((t) => (
              <Link key={t.key} href={t.href} aria-current={t.key === active ? "page" : undefined}>
                {t.label}
                {badges[t.key] ? <span className="new-pill">{badges[t.key]}</span> : null}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
