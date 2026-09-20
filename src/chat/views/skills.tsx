'use client';

/**
 * The Skills view: markdown the end-user writes once and the agent can load
 * whenever it helps — a protocol, a naming convention, the way their team
 * reports something.
 *
 * Two panes in one: the list, and the editor for whichever skill is open. The
 * list is what someone sees most, so it leads; writing is a deliberate step
 * behind "New skill" or a tap on a row.
 */
import { useId, useRef, useState, type FC } from 'react';
import { PencilIcon, PlusIcon, TrashIcon, UploadIcon } from 'lucide-react';
import type { UserSkill } from '../../types.js';
import { useChatContext } from '../provider.js';
import { skillFromMarkdown } from '../lib/use-skills.js';

const EMPTY: UserSkill = { name: '', description: '', content: '' };

export const SkillsView: FC = () => {
  const { skills } = useChatContext();
  const [editing, setEditing] = useState<UserSkill | null>(null);

  return (
    <div className="t2v-chat-skills aui-modal-skills bg-popover absolute inset-0 flex flex-col overflow-y-auto p-4 text-sm">
      {editing ? (
        <SkillEditor
          skill={editing}
          existing={skills.skills}
          onCancel={() => setEditing(null)}
          onSave={(next) => {
            if (skills.save(next)) setEditing(null);
          }}
        />
      ) : (
        <SkillList onEdit={setEditing} onNew={() => setEditing({ ...EMPTY })} />
      )}
    </div>
  );
};

const SkillList: FC<{ onEdit: (skill: UserSkill) => void; onNew: () => void }> = ({
  onEdit,
  onNew,
}) => {
  const { skills } = useChatContext();
  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const importFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setImportError(null);
    for (const file of Array.from(files)) {
      try {
        const text = await file.text();
        if (!text.trim()) throw new Error('empty');
        skills.save(skillFromMarkdown(file.name, text));
      } catch {
        setImportError(`Couldn’t read ${file.name}.`);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Markdown the assistant can read when it needs what you know. Kept on this device, sent
          with your chats.
        </p>
      </div>

      <div className="flex gap-2">
        <button type="button" className={BUTTON} onClick={onNew}>
          <PlusIcon className="size-3.5" aria-hidden="true" />
          New skill
        </button>
        <button type="button" className={BUTTON} onClick={() => fileRef.current?.click()}>
          <UploadIcon className="size-3.5" aria-hidden="true" />
          Import .md
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          multiple
          className="hidden"
          onChange={(e) => void importFiles(e.target.files)}
        />
      </div>

      {importError ? <p className="text-destructive text-xs">{importError}</p> : null}
      {skills.status === 'error' ? (
        <p className="text-destructive text-xs">
          Couldn’t save your skills to this chat. They are still on this device.
        </p>
      ) : null}

      {skills.skills.length === 0 ? (
        <p className="text-muted-foreground border-foreground/10 border border-dashed p-4 text-center text-xs">
          No skills yet. Write one, or import a markdown file.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {skills.skills.map((skill) => {
            const on = !skills.disabled.has(skill.name);
            return (
              <li
                key={skill.name}
                className="border-foreground/10 flex items-start gap-3 border p-3"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="accent-primary mt-0.5 size-3.5 shrink-0"
                    checked={on}
                    onChange={(e) => skills.toggle(skill.name, e.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{skill.name}</span>
                    <span className="text-muted-foreground block truncate text-xs">
                      {skill.description || `${skill.content.trim().split(/\s+/).length} words`}
                    </span>
                  </span>
                </label>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label={`Edit ${skill.name}`}
                    onClick={() => onEdit(skill)}
                  >
                    <PencilIcon className="size-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={ICON_BUTTON}
                    aria-label={`Delete ${skill.name}`}
                    onClick={() => skills.remove(skill.name)}
                  >
                    <TrashIcon className="size-3.5" aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const SkillEditor: FC<{
  skill: UserSkill;
  existing: UserSkill[];
  onSave: (skill: UserSkill) => void;
  onCancel: () => void;
}> = ({ skill, existing, onSave, onCancel }) => {
  const nameId = useId();
  const descriptionId = useId();
  const contentId = useId();
  const [draft, setDraft] = useState<UserSkill>(skill);
  const isNew = !skill.name;
  const clash =
    isNew && draft.name.trim() && existing.some((s) => s.name === draft.name.trim())
      ? 'A skill with this name already exists — saving replaces it.'
      : null;
  const ready = draft.name.trim().length > 0 && draft.content.trim().length > 0;

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSave(draft);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <label htmlFor={nameId} className="font-medium">
          Name
        </label>
        <input
          id={nameId}
          className={INPUT}
          value={draft.name}
          maxLength={255}
          placeholder="reporting-style"
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <p className="text-muted-foreground text-xs">
          {clash ?? 'How the assistant refers to it. Short and specific.'}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={descriptionId} className="font-medium">
          Description
        </label>
        <input
          id={descriptionId}
          className={INPUT}
          value={draft.description}
          placeholder="When to use this"
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <p className="text-muted-foreground text-xs">
          One line. This is what the assistant reads when deciding whether to load it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={contentId} className="font-medium">
          Content
        </label>
        <textarea
          id={contentId}
          className={`${INPUT} min-h-48 resize-y py-2 font-mono text-xs leading-relaxed`}
          value={draft.content}
          placeholder={'# Reporting style\n\nAlways lead with the finding, then the measurement.'}
          onChange={(e) => setDraft({ ...draft, content: e.target.value })}
        />
        <p className="text-muted-foreground text-xs">
          Markdown. Everything here is sent with your chats, so keep it to what the assistant needs.
        </p>
      </div>

      <div className="flex gap-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={!ready}>
          Save skill
        </button>
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};

const INPUT =
  'border-input bg-background text-foreground focus-visible:ring-ring w-full border px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2';

const BUTTON =
  'border-input text-foreground hover:bg-muted inline-flex h-8 items-center gap-1.5 border px-3 text-xs font-medium';

const PRIMARY_BUTTON =
  'bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 items-center px-3 text-xs font-medium disabled:opacity-50';

const ICON_BUTTON =
  'text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-7 items-center justify-center';
