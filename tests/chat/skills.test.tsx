/**
 * The end-user's own skills, driven through the chat itself.
 *
 * Real: the provider, the skills store, `localStorage`, the view and the
 * header. Scripted: the engine, so what reaches `/v1/skills/register` can be
 * asserted. The real `T2VSkills` runs here — these tests are about it — so the
 * usual stub is deliberately absent.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const requests: { path: string; body: unknown }[] = [];

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockImplementation((path: string, init?: { body?: string }) => {
      requests.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
      if (path === '/v1/skills/register') return Promise.resolve({ registered: [], count: 0 });
      return Promise.resolve({ data: [] });
    }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: () => () => {},
    getUser: () => ({ id: 'u1', email: 'a@b.c' }),
    isAnonymous: () => false,
    startAnonymous: vi.fn().mockResolvedValue(null),
    listen: vi.fn(),
    destroy: vi.fn(),
  })),
}));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(() => ({
    reRegister: vi.fn().mockResolvedValue(null),
    register: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    handle: vi.fn(),
  })),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));

import { Talk2ViewChat } from '../../src/chat/chat';
import { skillFromMarkdown } from '../../src/chat/lib/use-skills';

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  window.matchMedia = (() => ({
    matches: false,
    media: '',
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

beforeEach(() => {
  localStorage.clear();
  requests.length = 0;
});

afterEach(() => {
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
});

const openSkills = async () => {
  render(<Talk2ViewChat partnerKey="pk_test_x" anonymousAutoStart={false} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Skills' }));
  return screen.findByText('New skill');
};

const registered = () =>
  requests.filter((r) => r.path === '/v1/skills/register').map((r) => (r.body as { skills: { name: string }[] }).skills);

describe('the Skills view', () => {
  it('is reachable from the header, beside the other views', async () => {
    render(<Talk2ViewChat partnerKey="pk_test_x" anonymousAutoStart={false} />);
    for (const name of ['Account', 'Settings', 'Skills', 'New chat']) {
      expect(await screen.findByRole('button', { name })).toBeTruthy();
    }
  });

  it('can be switched off by the integrator', async () => {
    render(
      <Talk2ViewChat partnerKey="pk_test_x" anonymousAutoStart={false} features={{ skills: false }} />,
    );
    await screen.findByRole('button', { name: 'Settings' });
    expect(screen.queryByRole('button', { name: 'Skills' })).toBeNull();
  });

  it('says so when there is nothing on the device yet', async () => {
    await openSkills();
    expect(screen.getByText(/No skills yet/)).toBeTruthy();
  });

  it('writes a skill, keeps it on the device and sends it to the engine', async () => {
    await openSkills();
    fireEvent.click(screen.getByText('New skill'));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'reporting-style' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'How we report' } });
    fireEvent.change(screen.getByLabelText('Content'), {
      target: { value: '# Style\n\nLead with the finding.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    await screen.findByText('reporting-style');
    expect(JSON.parse(localStorage.getItem('t2v_user_skills') ?? '[]')).toHaveLength(1);
    await waitFor(() => expect(registered().at(-1)).toHaveLength(1));
    expect(registered().at(-1)?.[0]?.name).toBe('reporting-style');
  });

  it('keeps a switched-off skill but stops sending it', async () => {
    localStorage.setItem(
      't2v_user_skills',
      JSON.stringify([{ name: 'kept', description: '', content: 'body' }]),
    );
    await openSkills();
    await waitFor(() => expect(registered().at(-1)).toHaveLength(1));

    fireEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(registered().at(-1)).toHaveLength(0));
    expect(screen.getByText('kept')).toBeTruthy();
    expect(JSON.parse(localStorage.getItem('t2v_disabled_skills') ?? '[]')).toEqual(['kept']);
  });

  it('honours a skill the viewer switched off before this chat existed', async () => {
    localStorage.setItem(
      't2v_user_skills',
      JSON.stringify([
        { name: 'on', description: '', content: 'a' },
        { name: 'off', description: '', content: 'b' },
      ]),
    );
    localStorage.setItem('t2v_disabled_skills', JSON.stringify(['off']));
    await openSkills();
    await waitFor(() => expect(registered().at(-1)).toHaveLength(1));
    expect(registered().at(-1)?.[0]?.name).toBe('on');
  });

  it('deletes a skill from the device and from the next registration', async () => {
    localStorage.setItem(
      't2v_user_skills',
      JSON.stringify([{ name: 'gone', description: '', content: 'body' }]),
    );
    await openSkills();
    await waitFor(() => expect(registered().at(-1)).toHaveLength(1));

    fireEvent.click(screen.getByRole('button', { name: 'Delete gone' }));

    await waitFor(() => expect(registered().at(-1)).toHaveLength(0));
    expect(JSON.parse(localStorage.getItem('t2v_user_skills') ?? '[]')).toEqual([]);
  });

  it('edits in place rather than adding a second skill with the same name', async () => {
    localStorage.setItem(
      't2v_user_skills',
      JSON.stringify([{ name: 'one', description: 'first', content: 'body' }]),
    );
    await openSkills();
    fireEvent.click(screen.getByRole('button', { name: 'Edit one' }));
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save skill' }));

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('will not save a skill with no name or no content', async () => {
    await openSkills();
    fireEvent.click(screen.getByText('New skill'));
    const save = screen.getByRole('button', { name: 'Save skill' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'named' } });
    expect((screen.getByRole('button', { name: 'Save skill' }) as HTMLButtonElement).disabled).toBe(
      true,
    );

    fireEvent.change(screen.getByLabelText('Content'), { target: { value: 'body' } });
    expect((screen.getByRole('button', { name: 'Save skill' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });
});

describe('importing a markdown file', () => {
  it('takes the name and description from frontmatter', () => {
    const skill = skillFromMarkdown(
      'Some File.md',
      '---\nname: chest-protocol\ndescription: "How we read chests"\n---\n\n# Chest\n\nBody.',
    );
    expect(skill).toEqual({
      name: 'chest-protocol',
      description: 'How we read chests',
      content: '# Chest\n\nBody.',
    });
  });

  it('falls back to the filename when there is no frontmatter', () => {
    const skill = skillFromMarkdown('Chest Protocol.md', '# Chest\n\nBody.');
    expect(skill.name).toBe('chest-protocol');
    expect(skill.description).toBe('');
    expect(skill.content).toBe('# Chest\n\nBody.');
  });
});
