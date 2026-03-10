/**
 * Skills module — register user-defined skills for the current session.
 *
 * Skills are knowledge documents (markdown) that the AI agent can discover
 * and load to gain specialised expertise. They are stored client-side
 * and sent to the server at session start.
 */

import type { T2VClient } from './client';
import type { RegisterSkillsResponse, UserSkill } from './types';

const STORAGE_KEY = 't2v_user_skills';

export class T2VSkills {
  private skills: UserSkill[] = [];

  constructor(private readonly client: T2VClient) {}

  /**
   * Register skills with the server for the current session.
   *
   * Sends all provided skills to the server where they are merged with
   * partner and built-in skills (user skills take highest priority).
   *
   * Call this once at session start, before sending messages.
   */
  async register(skills: UserSkill[]): Promise<RegisterSkillsResponse> {
    this.skills = [...skills];

    return this.client.request<RegisterSkillsResponse>('/v1/skills/register', {
      method: 'POST',
      body: JSON.stringify({ skills }),
    });
  }

  /**
   * Add a skill to the local list (does NOT register with server).
   * Call `register()` afterwards to sync with the server.
   */
  add(skill: UserSkill): void {
    const idx = this.skills.findIndex((s) => s.name === skill.name);
    if (idx >= 0) {
      this.skills[idx] = skill;
    } else {
      this.skills.push(skill);
    }
  }

  /**
   * Remove a skill from the local list by name.
   * Call `register()` afterwards to sync with the server.
   */
  remove(name: string): boolean {
    const before = this.skills.length;
    this.skills = this.skills.filter((s) => s.name !== name);
    return this.skills.length < before;
  }

  /**
   * Get all locally-stored skills.
   */
  getAll(): UserSkill[] {
    return [...this.skills];
  }

  /**
   * Save skills to localStorage for persistence across page reloads.
   */
  save(): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.skills));
  }

  /**
   * Load skills from localStorage.
   * Does NOT register them — call `register()` to sync with the server.
   */
  load(): UserSkill[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        this.skills = JSON.parse(raw);
      }
    } catch {
      // Ignore corrupt data
    }
    return [...this.skills];
  }

  /**
   * Clear all locally-stored skills (and remove from localStorage).
   */
  clear(): void {
    this.skills = [];
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
}
