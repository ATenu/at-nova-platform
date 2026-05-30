import { useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from '@/components/ui/Icon';

export function ChatComposer({
  disabled,
  onSend,
}: {
  disabled: boolean;
  onSend: (message: string) => void;
}) {
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || disabled) {
      return;
    }
    onSend(trimmed);
    setValue('');
    if (ref.current) {
      ref.current.style.height = 'auto';
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="chat-composer">
      <textarea
        ref={ref}
        className="textarea grow"
        placeholder="Ask Nova about customers, sales, issues, actions, or SOPs…"
        value={value}
        rows={1}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
        }}
        onKeyDown={onKeyDown}
        aria-label="Message"
      />
      <button
        className="btn btn-primary btn-icon"
        onClick={submit}
        disabled={disabled || value.trim().length === 0}
        aria-label="Send message"
      >
        <Icon name="send" size={18} />
      </button>
    </div>
  );
}
