'use client';

/**
 * The end-user's own skills: markdown the agent can load to learn something
 * only this person or this team knows — a protocol, a house style, the way
 * their department names things.
 *
 * Where they live: this device. The list is the SDK's own skill store
 * (`t2v_user_skills` in localStorage) and the switched-off ones are a set of
 * names beside it, so a skill can be kept without being sent. Both keys are
 * the ones the OHIF viewer already wrote, so its existing skills survive the
 * move into this chat.
 *
 * When they are sent: the enabled ones go to the engine for the current
 * session, where they merge with the partner's and the built-in ones, and win
 * over both. Registering needs somebody signed in — a guest counts — so
 * nothing is sent before then, and the client registers again on its own
 * whenever it starts a session.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Talk2View } from '../../index.js';
import type { UserSkill } from '../../types.js';

const DISABLED_KEY = 't2v_disabled_skills';

export interface SkillsStore {
  /** Every skill on this device, in the order they were added. */
  skills: UserSkill[];
  /** Names that are switched off: kept here, never sent. */
  disabled: ReadonlySet<string>;
  /** Add or replace by name. Returns false when the name is empty. */
  save: (skill: UserSkill) => boolean;
  remove: (name: string) => void;
  toggle: (name: string, enabled: boolean) => void;
  /** What would be sent right now. */
  enabled: UserSkill[];
  /** Whether the last register attempt reached the engine. */
  status: 'idle' | 'saving' | 'error';
}

function readDisabled(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(DISABLED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeDisabled(disabled: ReadonlySet<string>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...disabled]));
  } catch {
    // A full or blocked store costs the preference, not the skill.
  }
}

export function useSkills(client: Talk2View, options: { enabled: boolean }): SkillsStore {
  const live = options.enabled;
  const [skills, setSkills] = useState<UserSkill[]>([]);
  const [disabled, setDisabled] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle');

  // Read the device's list once. `load()` also seeds the client's own store,
  // which is what the client re-registers when it starts a session.
  useEffect(() => {
    if (!live) return;
    setSkills(client.skills.load());
    setDisabled(readDisabled());
  }, [client, live]);

  const enabled = useMemo(() => skills.filter((s) => !disabled.has(s.name)), [skills, disabled]);

  // Send the enabled set whenever it changes, and again when somebody signs
  // in. Registering needs a session, and a session needs an account — a guest
  // counts — so before that there is nobody to register them for: the call
  // would 401, in the console of every logged-out visitor, for nothing. The
  // client registers on its own when it starts a session, which covers the
  // visitor who signs in by sending their first message as a guest.
  const [identity, setIdentity] = useState(() => client.auth.getUser()?.id ?? null);
  useEffect(() => {
    if (!live) return;
    return client.auth.onAuthStateChange((user) => setIdentity(user?.id ?? null));
  }, [client, live]);

  const lastSent = useRef<string>('');
  useEffect(() => {
    if (!live) return;
    if (!identity) {
      // Nothing is registered for nobody, so the next signed-in run must send.
      lastSent.current = '';
      return;
    }
    const payload = JSON.stringify(enabled);
    if (payload === lastSent.current) return;
    lastSent.current = payload;
    let cancelled = false;
    setStatus('saving');
    client.skills
      .register(enabled)
      .then(() => !cancelled && setStatus('idle'))
      .catch(() => {
        if (cancelled) return;
        lastSent.current = '';
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client, enabled, identity, live]);

  const persist = useCallback(
    (next: UserSkill[]) => {
      setSkills(next);
      // The client's store is the copy that gets re-registered on a new
      // session, so keep it to the enabled set and the device's file whole.
      client.skills.clear();
      next.forEach((s) => client.skills.add(s));
      client.skills.save();
    },
    [client],
  );

  const save = useCallback(
    (skill: UserSkill) => {
      const name = skill.name.trim();
      if (!name || !skill.content.trim()) return false;
      const cleaned: UserSkill = {
        name,
        description: skill.description.trim(),
        content: skill.content,
      };
      const idx = skills.findIndex((s) => s.name === name);
      persist(idx >= 0 ? skills.map((s, i) => (i === idx ? cleaned : s)) : [...skills, cleaned]);
      return true;
    },
    [persist, skills],
  );

  const remove = useCallback(
    (name: string) => {
      persist(skills.filter((s) => s.name !== name));
      setDisabled((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        writeDisabled(next);
        return next;
      });
    },
    [persist, skills],
  );

  const toggle = useCallback((name: string, on: boolean) => {
    setDisabled((prev) => {
      const next = new Set(prev);
      if (on) next.delete(name);
      else next.add(name);
      writeDisabled(next);
      return next;
    });
  }, []);

  return { skills, disabled, save, remove, toggle, enabled, status };
}

/** Pull `name`, `description` and the body out of a markdown file. */
export function skillFromMarkdown(filename: string, text: string): UserSkill {
  const fallbackName = filename
    .replace(/\.[^.]+$/, '')
    .replace(/[_\s]+/g, '-')
    .toLowerCase();

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { name: fallbackName, description: '', content: text.trim() };

  const front: Record<string, string> = {};
  for (const line of match[1]!.split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim().toLowerCase();
    const value = line
      .slice(at + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
    if (key && value) front[key] = value;
  }
  return {
    name: front.name || fallbackName,
    description: front.description || '',
    content: text.slice(match[0].length).trim() || text.trim(),
  };
}
