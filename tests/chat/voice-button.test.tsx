/**
 * `<VoiceButton>` — the realtime voice agent's one control, and its place
 * beside the launcher.
 *
 * Most tests drive a scripted `t2v.voice` (the facade's surface: `state`,
 * `start`, `stop`, `on`) so each state can be put up directly. One drives the
 * real facade, to prove a press while voice is still loading is a hang-up.
 * Plain DOM assertions throughout: this repo has no jest-dom.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/client', () => ({
  T2VClient: vi.fn().mockImplementation(() => ({
    request: vi.fn().mockResolvedValue({ data: [] }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  })),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(() => ({
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
    isAnonymous: vi.fn().mockReturnValue(false),
    startAnonymous: vi.fn().mockResolvedValue(null),
    getPopupProviders: vi.fn().mockResolvedValue([]),
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
vi.mock('../../src/skills', () => ({
  T2VSkills: vi.fn().mockImplementation(() => ({
    getAll: () => [],
    load: () => [],
    add: () => {},
    remove: () => false,
    save: () => {},
    clear: () => {},
    register: async () => ({ registered: [], count: 0 }),
  })),
}));

import { Talk2View } from '../../src/index';
import { TypedEventEmitter } from '../../src/event-emitter';
import type { PartnerConfig, VoiceEventMap, VoiceState } from '../../src/types';
import { T2VVoice } from '../../src/voice-facade';
import { Talk2ViewChatLauncher } from '../../src/chat/launcher';
import { VoiceButton, shouldShowVoice, voiceErrorMessage } from '../../src/chat/voice-button';

/** Whether the launcher's phone-sheet media query matches. */
let phone = false;

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
  Element.prototype.scrollTo = Element.prototype.scrollTo ?? (() => {});
  window.matchMedia = ((query: string) => ({
    // Only the launcher's sheet query asks; `phone` answers it.
    matches: phone && /max-width/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  phone = false;
  document.querySelectorAll('.t2v-portal-host').forEach((el) => el.remove());
  document.documentElement.style.overflow = '';
});

/** A scripted `t2v.voice`. `listeners()` counts what the button still holds. */
function fakeClient() {
  const emitter = new TypedEventEmitter<VoiceEventMap>();
  let live = 0;
  const setState = (s: VoiceState) => {
    voice.state = s;
    emitter.emit('stateChange', s);
  };
  const voice = {
    state: 'idle' as VoiceState,
    start: vi.fn(async () => {
      setState('connecting');
      setState('listening');
    }),
    stop: vi.fn(async () => {
      setState('ended');
      emitter.emit('ended', 'stopped');
    }),
    on: (event: string, cb: (...args: never[]) => void) => {
      const off = emitter.on(event, cb as (...args: unknown[]) => void);
      live += 1;
      return () => {
        live -= 1;
        off();
      };
    },
  };
  return {
    client: { voice } as unknown as Talk2View,
    emitter,
    voice,
    setState,
    listeners: () => live,
  };
}

const button = () => screen.getByRole('button', { name: 'Talk to Talk2View' });

describe('<VoiceButton>', () => {
  it('starts on a press, shows it is listening, and hangs up on the next press', async () => {
    const { client, voice } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    expect(button().getAttribute('aria-pressed')).toBe('false');

    await act(async () => {
      fireEvent.click(button());
    });
    expect(voice.start).toHaveBeenCalledOnce();
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('data-state')).toBe('listening');
    expect(screen.getByRole('status').textContent).toBe('Listening');

    await act(async () => {
      fireEvent.click(button());
    });
    expect(voice.stop).toHaveBeenCalledOnce();
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(button().getAttribute('data-state')).toBe('ended');
  });

  it('a press while the call is still connecting hangs up, and does not start another', async () => {
    const { client, voice, setState } = fakeClient();
    voice.start.mockImplementation(async () => setState('connecting'));
    render(<VoiceButton client={client} earcon={false} />);

    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().getAttribute('data-state')).toBe('connecting');
    expect(button().getAttribute('aria-pressed')).toBe('true');
    expect(button().getAttribute('aria-busy')).toBe('true');
    // Never disabled: pressing again is how a slow connect is cancelled.
    expect(button().hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('status').textContent).toBe('Connecting…');

    await act(async () => {
      fireEvent.click(button());
    });
    expect(voice.stop).toHaveBeenCalledOnce();
    expect(voice.start).toHaveBeenCalledOnce();
  });

  it('works from the keyboard: it is a real button with a name', async () => {
    const { client, voice } = fakeClient();
    render(<VoiceButton client={client} earcon={false} label="Talk to Radiology" />);
    const b = screen.getByRole('button', { name: 'Talk to Radiology' });
    expect(b.tagName).toBe('BUTTON');
    expect(b.getAttribute('type')).toBe('button');
    b.focus();
    expect(document.activeElement).toBe(b);
    await act(async () => {
      fireEvent.click(b); // what Enter and Space do on a native button
    });
    expect(voice.start).toHaveBeenCalledOnce();
  });

  it('shows the agent working', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('agentState', 'working'));
    expect(button().getAttribute('data-busy')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Working…');
    act(() => emitter.emit('agentState', 'idle'));
    expect(button().getAttribute('data-busy')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Listening');
  });

  it('says why a call ended when it was not the end-user’s press, then clears it', () => {
    vi.useFakeTimers();
    try {
      const { client, emitter, setState } = fakeClient();
      render(<VoiceButton client={client} earcon={false} />);
      act(() => setState('listening'));
      act(() => {
        setState('ended');
        emitter.emit('ended', 'session_cap');
      });
      expect(screen.getByRole('status').textContent).toBe('The call reached its time limit.');
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(screen.getByRole('status').textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a readable error, and clears it when the next call starts', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => {
      emitter.emit('error', { type: 'voice_at_capacity', message: 'HTTP 503' });
      setState('error');
    });
    expect(screen.getByRole('alert').textContent).toContain('Voice is busy right now. Try again shortly.');
    expect(button().getAttribute('data-state')).toBe('error');
    expect(button().getAttribute('aria-pressed')).toBe('false');

    act(() => setState('connecting'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('can dismiss an error', () => {
    const { client, emitter } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => emitter.emit('error', { type: 'insufficient_credit', message: 'x' }));
    expect(screen.getByRole('alert').textContent).toContain('out of credit');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a start that rejects does not throw out of the press', async () => {
    const { client, voice } = fakeClient();
    voice.start.mockImplementation(async () => {
      throw Object.assign(new Error('nope'), { type: 'voice_disabled' });
    });
    render(<VoiceButton client={client} earcon={false} />);
    await act(async () => {
      fireEvent.click(button());
    });
    expect(voice.start).toHaveBeenCalled();
  });

  it('renders the approval card and forwards the decision', () => {
    const { client, emitter } = fakeClient();
    const decide = vi.fn();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => {
      emitter.emit('approvalChange', {
        toolCallId: 'c1',
        toolName: 'delete_files',
        arguments: { count: 3 },
        description: 'Deletes files',
        decide,
      });
    });
    expect(screen.queryByRole('region', { name: /delete_files/ })).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ action: 'once' }));
    act(() => emitter.emit('approvalChange', null));
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('lets go of every listener, and hangs up a live call, when it unmounts', () => {
    const { client, voice, setState, listeners } = fakeClient();
    const view = render(<VoiceButton client={client} earcon={false} />);
    expect(listeners()).toBeGreaterThan(0);
    act(() => setState('listening'));
    view.unmount();
    expect(listeners()).toBe(0);
    expect(voice.stop).toHaveBeenCalledOnce();
  });

  it('does not hang up anything when it unmounts idle', () => {
    const { client, voice } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />).unmount();
    expect(voice.stop).not.toHaveBeenCalled();
  });

  it('carries the chat root class itself when standalone, so the stylesheet reaches it', () => {
    const { client } = fakeClient();
    const { container } = render(<VoiceButton client={client} earcon={false} className="dark" />);
    const root = container.firstElementChild!;
    expect(root.classList.contains('t2v-voice')).toBe(true);
    expect(root.classList.contains('t2v-chat')).toBe(true);
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('needs a client outside a chat', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => render(<VoiceButton />)).toThrow(/needs a client/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('with the real facade', () => {
  it('a press while voice is still loading hangs up, and the button says so', async () => {
    const t2v = { voice: new T2VVoice({
      request: vi.fn(),
      ensureSession: vi.fn(),
      getValidAccessToken: vi.fn(),
      tools: {} as never,
      partnerKey: 'pk_test_x',
      // Never loads: the call stays in "connecting" until it is hung up.
      loadController: () => new Promise(() => {}),
    }) } as unknown as Talk2View;
    render(<VoiceButton client={t2v} earcon={false} />);

    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().getAttribute('data-state')).toBe('connecting');

    await act(async () => {
      fireEvent.click(button());
    });
    expect(button().getAttribute('data-state')).toBe('ended');
    expect(button().getAttribute('aria-pressed')).toBe('false');
    expect(t2v.voice.state).toBe('ended');
  });
});

describe('voiceErrorMessage', () => {
  it('has a message of its own for each known reason, and falls back to the one given', () => {
    for (const type of [
      'voice_disabled',
      'account_required',
      'insufficient_credit',
      'credit_check_unavailable',
      'service_unconfigured',
      'voice_at_capacity',
      'voice_ticket_invalid',
      'upstream_error',
      'transport_error',
    ]) {
      const message = voiceErrorMessage({ type, message: 'raw' });
      expect(message).not.toBe('raw');
      expect(message.length).toBeGreaterThan(0);
    }
    expect(voiceErrorMessage({ type: 'voice_error', message: 'Could not load voice.' })).toBe(
      'Could not load voice.',
    );
    expect(voiceErrorMessage({ type: 'something_new', message: '' })).toMatch(/went wrong/);
  });

  it('tells the end-user to allow the microphone when it is unavailable', () => {
    expect(voiceErrorMessage({ type: 'mic_unavailable', message: 'raw' })).toBe(
      'Voice needs microphone access. Allow the microphone and try again.',
    );
  });
});

describe('shouldShowVoice', () => {
  it('needs the feature on and the partner flag on', () => {
    const on = { voice_agent_enabled: true } as PartnerConfig;
    const off = { voice_agent_enabled: false } as PartnerConfig;
    expect(shouldShowVoice({ voice: true }, on)).toBe(true);
    expect(shouldShowVoice({}, on)).toBe(true);
    expect(shouldShowVoice({ voice: false }, on)).toBe(false);
    expect(shouldShowVoice({ voice: true }, off)).toBe(false);
    expect(shouldShowVoice({ voice: true }, {} as PartnerConfig)).toBe(false);
    expect(shouldShowVoice({ voice: true }, null)).toBe(false);
  });
});

describe('beside the launcher', () => {
  async function mountLauncher(config: Partial<PartnerConfig>, features?: { voice?: boolean }) {
    const client = new Talk2View({ partnerKey: 'pk_test_x' });
    vi.spyOn(client, 'getConfig').mockResolvedValue(config as PartnerConfig);
    render(<Talk2ViewChatLauncher client={client} features={features} />);
    await act(async () => {});
    return client;
  }
  const voiceButton = () => document.querySelector('.aui-modal-anchor .t2v-voice-button');

  it('sits before the mark when the partner has voice on', async () => {
    await mountLauncher({ voice_agent_enabled: true });
    const tile = voiceButton();
    expect(tile).not.toBeNull();
    // The anchor ends at the corner, so the mark keeps it and voice sits left.
    const wrapper = tile!.closest('.t2v-voice')!;
    expect(wrapper.nextElementSibling?.classList.contains('aui-modal-button')).toBe(true);
    // Inside the anchor it is not a chat root of its own: a second `.t2v-chat`
    // would re-declare the light tokens over a dark launcher.
    expect(wrapper.classList.contains('t2v-chat')).toBe(false);
  });

  it('is not there when the partner has voice off', async () => {
    await mountLauncher({ voice_agent_enabled: false });
    expect(voiceButton()).toBeNull();
  });

  it('steps aside over an open phone sheet, where it would cover the composer', async () => {
    phone = true;
    await mountLauncher({ voice_agent_enabled: true });
    const wrapper = () => voiceButton()!.closest('.t2v-voice')!;
    expect(wrapper().classList.contains('t2v-voice-tucked')).toBe(false);
    await act(async () => {
      fireEvent.click(document.querySelector<HTMLElement>('.aui-modal-button')!);
    });
    // Hidden by CSS, not unmounted: unmounting would hang up a live call.
    expect(wrapper().classList.contains('t2v-voice-tucked')).toBe(true);
  });

  it('appears once a session exists, when the first config request was refused', async () => {
    const client = new Talk2View({ partnerKey: 'pk_test_x' });
    // A brand-new visitor: no session yet, so /v1/config 401s.
    const getConfig = vi
      .spyOn(client, 'getConfig')
      .mockRejectedValueOnce(new Error('401'))
      .mockResolvedValue({ voice_agent_enabled: true } as PartnerConfig);
    render(<Talk2ViewChatLauncher client={client} />);
    await act(async () => {});
    expect(voiceButton()).toBeNull();

    // A guest session starts (or someone signs in): every auth listener runs.
    const onAuth = client.auth.onAuthStateChange as unknown as { mock: { calls: [(u: unknown) => void][] } };
    await act(async () => {
      for (const [listener] of onAuth.mock.calls) listener({ id: 'guest-1' });
    });
    expect(getConfig).toHaveBeenCalledTimes(2);
    expect(voiceButton()).not.toBeNull();

    // A sign-out is never answered with a request (that is how a sessionless
    // 401 looped), and neither is the same user announced again.
    const announce = async (user: unknown) =>
      act(async () => {
        for (const [listener] of onAuth.mock.calls) listener(user);
      });
    await announce({ id: 'guest-1' });
    await announce(null);
    expect(getConfig).toHaveBeenCalledTimes(2);
    // A different user signing in afterwards is asked for again.
    await announce({ id: 'user-2' });
    expect(getConfig).toHaveBeenCalledTimes(3);
  });

  it('is not there when the integrator turns it off', async () => {
    await mountLauncher({ voice_agent_enabled: true }, { voice: false });
    expect(voiceButton()).toBeNull();
  });
});
