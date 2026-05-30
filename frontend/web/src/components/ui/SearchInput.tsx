import { Icon } from './Icon';

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="grow" style={{ position: 'relative', maxWidth: 320 }}>
      <span
        style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-subtle)' }}
      >
        <Icon name="search" size={16} />
      </span>
      <input
        className="input"
        style={{ paddingLeft: 34 }}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
    </div>
  );
}
