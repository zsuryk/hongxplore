import { type FormEvent, useEffect, useState } from 'react';
import {
  ACCESS_KEY_CANCEL_LABEL,
  ACCESS_KEY_HELP_TEXT,
  ACCESS_KEY_INPUT_LABEL,
  ACCESS_KEY_INPUT_PLACEHOLDER,
  ACCESS_KEY_MODAL_DESCRIPTION,
  ACCESS_KEY_MODAL_TITLE,
  ACCESS_KEY_SUBMIT_LABEL,
} from './copy';
import { useBoardStore } from './state/boardStore';

export type AgentAccessKeyModalProps = {
  isOpen?: boolean;
  onClose?: () => void;
  onSubmit?: (key: string) => void;
  initialKey?: string;
};

type AgentAccessKeyDialogProps = {
  initialKey: string;
  onClose: () => void;
  onSubmit: (key: string) => void;
};

function AgentAccessKeyDialog({ initialKey, onClose, onSubmit }: AgentAccessKeyDialogProps) {
  const [keyInput, setKeyInput] = useState(initialKey);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = keyInput.trim();
    if (trimmed) {
      onSubmit(trimmed);
      onClose();
    }
  }

  return (
    <div
      aria-describedby="agent-access-key-desc"
      aria-labelledby="agent-access-key-title"
      aria-modal="true"
      className="board-modal-backdrop"
      onClick={onClose}
      role="dialog"
    >
      <div className="board-modal" onClick={(event) => event.stopPropagation()}>
        <h2 id="agent-access-key-title">{ACCESS_KEY_MODAL_TITLE}</h2>
        <p id="agent-access-key-desc">{ACCESS_KEY_MODAL_DESCRIPTION}</p>
        <form onSubmit={handleSubmit}>
          <div className="board-modal__input-row">
            <label className="sr-only" htmlFor="agent-access-key-field">
              {ACCESS_KEY_INPUT_LABEL}
            </label>
            <input
              autoComplete="off"
              autoFocus
              className="field"
              id="agent-access-key-field"
              onChange={(event) => setKeyInput(event.target.value)}
              placeholder={ACCESS_KEY_INPUT_PLACEHOLDER}
              spellCheck={false}
              type="password"
              value={keyInput}
            />
          </div>
          <p className="board-modal__help">{ACCESS_KEY_HELP_TEXT}</p>
          <div className="board-modal__actions">
            <button className="btn btn--sm" onClick={onClose} type="button">
              {ACCESS_KEY_CANCEL_LABEL}
            </button>
            <button className="btn btn--sm btn--primary" disabled={!keyInput.trim()} type="submit">
              {ACCESS_KEY_SUBMIT_LABEL}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function AgentAccessKeyModal({
  isOpen: propIsOpen,
  onClose: propOnClose,
  onSubmit: propOnSubmit,
  initialKey = '',
}: AgentAccessKeyModalProps = {}) {
  const storeIsOpen = useBoardStore((state) => state.isAccessKeyPromptOpen);
  const storeClose = useBoardStore((state) => state.closeAccessKeyPrompt);
  const storeSetKey = useBoardStore((state) => state.setAgentAccessKey);

  const isOpen = propIsOpen ?? storeIsOpen;
  const onClose = propOnClose ?? storeClose;
  const onSubmit = propOnSubmit ?? storeSetKey;

  if (!isOpen) {
    return null;
  }

  return <AgentAccessKeyDialog initialKey={initialKey} onClose={onClose} onSubmit={onSubmit} />;
}
