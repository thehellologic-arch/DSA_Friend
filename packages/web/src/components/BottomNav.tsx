export type Tab = "roadmap" | "practice" | "profile";

const TABS: { id: Tab; label: string }[] = [
  { id: "roadmap", label: "Roadmap" },
  { id: "practice", label: "Practice" },
  { id: "profile", label: "Profile" },
];

export default function BottomNav({
  tab,
  onChange,
}: {
  tab: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={tab === item.id ? "page" : undefined}
          onClick={() => onChange(item.id)}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
