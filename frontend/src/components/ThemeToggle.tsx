import { useTheme, type ThemePreference } from '../lib/theme';
import { MonitorIcon, MoonIcon, SunIcon } from './icons';

const OPTIONS: Array<{ value: ThemePreference; label: string; Icon: typeof SunIcon }> = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'system', label: 'Auto', Icon: MonitorIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
];

/** Full: three-way switch. Compact: one button that cycles through the options. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { pref, setPref } = useTheme();
  if (compact) {
    const index = OPTIONS.findIndex((o) => o.value === pref);
    const next = OPTIONS[(index + 1) % OPTIONS.length]!;
    const { Icon } = OPTIONS[index]!;
    return (
      <button
        type="button"
        className="btn-ghost !px-2.5"
        onClick={() => setPref(next.value)}
        aria-label={`Theme: ${OPTIONS[index]!.label}. Switch to ${next.label}`}
      >
        <Icon size={18} />
      </button>
    );
  }
  return (
    <div role="radiogroup" aria-label="Colour theme" className="grid grid-cols-3 rounded-xl border border-line bg-raised p-0.5">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          onClick={() => setPref(value)}
          className={`flex min-h-8 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-medium transition ${
            pref === value ? 'bg-surface font-semibold text-ink shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink'
          }`}
        >
          <Icon size={14} />
          {label}
        </button>
      ))}
    </div>
  );
}
