// Settings navigation lives in the main sidebar (see components/app-shell.tsx).
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}
