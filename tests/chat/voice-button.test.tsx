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
  T2VClient: vi.fn().mockImplementation(function () { return {
    request: vi.fn().mockResolvedValue({ data: [] }),
    streamRequest: vi.fn(),
    uploadRequest: vi.fn(),
  }; }),
}));
vi.mock('../../src/auth', () => ({
  T2VAuth: vi.fn().mockImplementation(function () { return {
    onAuthStateChange: vi.fn(),
    getUser: vi.fn().mockReturnValue(null),
    isAnonymous: vi.fn().mockReturnValue(false),
    startAnonymous: vi.fn().mockResolvedValue(null),
    getPopupProviders: vi.fn().mockResolvedValue([]),
    listen: vi.fn(),
    destroy: vi.fn(),
  }; }),
}));
vi.mock('../../src/tools', () => ({
  T2VTools: vi.fn().mockImplementation(function () { return {
    reRegister: vi.fn().mockResolvedValue(null),
    register: vi.fn().mockResolvedValue({ registered: [], count: 0 }),
    handle: vi.fn(),
  }; }),
  stripNullArgs: (args: Record<string, unknown>) => args,
}));
vi.mock('../../src/skills', () => ({
  T2VSkills: vi.fn().mockImplementation(function () { return {
    getAll: () => [],
    load: () => [],
    add: () => {},
    remove: () => false,
    save: () => {},
    clear: () => {},
    register: async () => ({ registered: [], count: 0 }),
  }; }),
}));

import { Talk2View, VOICE_PREFERENCE_URL } from '../../src/index';
import { TypedEventEmitter } from '../../src/event-emitter';
import type { PartnerConfig, VoiceEventMap, VoiceState } from '../../src/types';
import { T2VVoice } from '../../src/voice-facade';
import { Talk2ViewChatLauncher } from '../../src/chat/launcher';
import { VoiceButton, shouldShowVoice, voiceErrorMessage } from '../../src/chat/voice-button';
import { CONFIG_WAIT_MS } from '../../src/chat/provider';

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

/**
 * A scripted `t2v.voice`. `listeners()` counts what the button still holds.
 * The end-user is signed in and not an anonymous user, unless `auth` says otherwise.
 */
function fakeClient(auth: { isAuthenticated?: () => boolean; isAnonymous?: () => boolean } = {}) {
  const emitter = new TypedEventEmitter<VoiceEventMap>();
  let live = 0;
  const setState = (s: VoiceState) => {
    voice.state = s;
    emitter.emit('stateChange', s);
  };
  const voice = {
    state: 'idle' as VoiceState,
    preload: vi.fn(),
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
    client: {
      voice,
      auth: { isAuthenticated: () => true, isAnonymous: () => false, ...auth },
    } as unknown as Talk2View,
    emitter,
    voice,
    setState,
    listeners: () => live,
  };
}

const button = () => screen.getByRole('button', { name: 'Talk to Talk2View' });

/** The engine's note on the voice model, as the popover shows it. */
const NOTE = 'Using Gemini Live — this app doesn’t offer ElevenLabs.';
const note = () => document.querySelector('.t2v-voice-note');

/** What an ElevenLabs agent opens the call with (`callStarted.greeting`). */
const GREETING = 'Hi! What can I help you with?';
/** The call captions' box, and its lines as [role, text], oldest first. */
const captionsBox = () => document.querySelector('.t2v-voice-captions');
const captionLines = () =>
  [...document.querySelectorAll('.t2v-voice-caption')].map((el) => [el.getAttribute('data-role'), el.textContent]);

/**
 * The button's live regions, in the DOM's order: the status ("Connecting…",
 * "Say hello!"), then the note. A screen reader reads a live region out whole
 * whenever any of it changes, so the note has a region of its own: in the
 * status region's it would be read again with every change of status.
 */
const liveRegions = () => screen.getAllByRole('status');
const statusText = () => liveRegions()[0]?.textContent;
const noteAnnouncement = () => liveRegions()[1]?.textContent;

describe('<VoiceButton>', () => {
  it('fetches the voice code when the pointer reaches it or it takes focus', () => {
    const { client, voice } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    fireEvent.pointerEnter(button());
    fireEvent.focus(button());
    expect(voice.preload).toHaveBeenCalledTimes(2);
    expect(voice.start).not.toHaveBeenCalled();
  });

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
    expect(statusText()).toBe('Say hello!');

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
    expect(statusText()).toBe('Connecting…');

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

  it('asks the user to say hello until they speak, then shows it is listening', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    // Nothing tells a first-time user the call is waiting on them: say so.
    expect(statusText()).toBe('Say hello!');
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-hint')).toBe(true);
    // The bot talking is not the user speaking.
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Hello', final: true }));
    expect(statusText()).toBe('Say hello!');
    act(() => emitter.emit('transcript', { role: 'user', text: 'hi', final: false }));
    expect(statusText()).toBe('Listening');
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-hint')).toBe(false);
  });

  it('asks again on the next call', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('transcript', { role: 'user', text: 'hi', final: true }));
    act(() => setState('ended'));
    act(() => setState('connecting'));
    act(() => setState('listening'));
    expect(statusText()).toBe('Say hello!');
  });

  it('with captions off, shows the greeting instead of say hello on an elevenlabs call', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} callCaptions={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: 'Hi! What can I help you with?' }));
    expect(statusText()).toBe('Hi! What can I help you with?');
    // The agent has greeted, but the call is still waiting on the end-user: the same hint.
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-hint')).toBe(true);
    // A greeting is any length, in any language: it wraps where "Say hello!" never needs to.
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-greeting')).toBe(true);
    act(() => emitter.emit('transcript', { role: 'user', text: 'hi', final: false }));
    expect(statusText()).toBe('Listening');
    act(() => setState('ended'));
    act(() => setState('connecting'));
    act(() => setState('listening'));
    expect(statusText()).toBe('Say hello!'); // a Gemini Live call greets nothing
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-greeting')).toBe(false);
  });

  it('a Gemini Live call still says hello until the end-user speaks', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'gemini-live', greeting: null }));
    expect(statusText()).toBe('Say hello!');
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-hint')).toBe(true);
    // Its callStarted has no greeting: nothing is captioned until someone speaks.
    expect(captionsBox()).toBeNull();
    act(() => emitter.emit('transcript', { role: 'user', text: 'hel', final: false }));
    expect(statusText()).toBe('Listening');
    expect(captionLines()).toEqual([['user', 'hel']]);
  });

  it('shows what both sides say, newest last, and the greeting once', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: GREETING }));
    // The greeting is the first caption, so the status says the call is
    // listening rather than repeat it, with no hint styling.
    expect(captionLines()).toEqual([['bot', GREETING]]);
    expect(statusText()).toBe('Listening');
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-hint')).toBe(false);
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-greeting')).toBe(false);
    act(() => emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    act(() => emitter.emit('transcript', { role: 'user', text: 'open pricing', final: true }));
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Sure.', final: true }));
    expect(captionLines()).toEqual([['bot', GREETING], ['user', 'open pricing'], ['bot', 'Sure.']]);
    expect(statusText()).toBe('Listening');
    expect(document.querySelector('.t2v-voice-status')?.hasAttribute('data-hint')).toBe(false);
  });

  it('rewrites the greeting when the end-user talks over it', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: GREETING }));
    act(() => emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    // Cut short: the caption keeps only the words the agent said.
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Hi! What', final: true, replaces: true }));
    act(() => emitter.emit('transcript', { role: 'user', text: 'open pricing', final: true }));
    expect(captionLines()).toEqual([['bot', 'Hi! What'], ['user', 'open pricing']]);
  });

  it('takes only the agent’s first line for the greeting again', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: GREETING }));
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Hello!', final: true }));
    act(() => emitter.emit('transcript', { role: 'user', text: 'what can you do?', final: true }));
    // Said later in the call, the same words are a line of the call.
    act(() => emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    expect(captionLines()).toEqual([
      ['bot', `${GREETING} Hello!`],
      ['user', 'what can you do?'],
      ['bot', GREETING],
    ]);
  });

  it('trims the greeting once, so the agent saying it again is still the greeting', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: `  ${GREETING}  ` }));
    act(() => emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Ask me anything.', final: true }));
    // Shown once, and the next line joins it with one space, not the greeting's own.
    expect(captionLines()).toEqual([['bot', `${GREETING} Ask me anything.`]]);
  });

  it('clears the captions when the call ends, and starts the next call with none', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('transcript', { role: 'user', text: 'open pricing', final: true }));
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Sure.', final: true }));
    expect(captionLines()).toHaveLength(2);
    act(() => {
      setState('ended');
      emitter.emit('ended', 'stopped');
    });
    expect(captionsBox()).toBeNull();
    act(() => setState('connecting'));
    act(() => setState('listening'));
    expect(captionsBox()).toBeNull();
    act(() => emitter.emit('transcript', { role: 'user', text: 'hello again', final: true }));
    expect(captionLines()).toEqual([['user', 'hello again']]);
    // A call that fails, or a reset to idle, takes its captions with it too.
    act(() => setState('error'));
    expect(captionsBox()).toBeNull();
    act(() => setState('listening'));
    act(() => emitter.emit('transcript', { role: 'user', text: 'one more', final: true }));
    act(() => setState('idle'));
    expect(captionsBox()).toBeNull();
  });

  it('does not carry a greeting over into the next call', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: GREETING }));
    // Hung up before the agent said a word.
    act(() => {
      setState('ended');
      emitter.emit('ended', 'stopped');
    });
    act(() => setState('connecting'));
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'gemini-live', greeting: null }));
    act(() => emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    expect(captionLines()).toEqual([['bot', GREETING]]);
  });

  it('shows no captions when turned off by the prop', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} callCaptions={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: GREETING }));
    act(() => emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    act(() => emitter.emit('transcript', { role: 'user', text: 'open pricing', final: true }));
    expect(captionsBox()).toBeNull();
    // The status still works.
    expect(statusText()).toBe('Listening');
  });

  it('takes the captions down at once when they are turned off mid-call', () => {
    const { client, emitter, setState } = fakeClient();
    const view = render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('transcript', { role: 'user', text: 'open pricing', final: true }));
    expect(captionLines()).toEqual([['user', 'open pricing']]);
    view.rerender(<VoiceButton client={client} earcon={false} callCaptions={false} />);
    expect(captionsBox()).toBeNull();
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Sure.', final: true }));
    expect(captionsBox()).toBeNull();
    // Nothing said while they were off is kept for later.
    view.rerender(<VoiceButton client={client} earcon={false} />);
    expect(captionLines().flat()).not.toContain('Sure.');
  });

  it('starts afresh when captions are turned on again mid-call', () => {
    const { client, emitter, setState } = fakeClient();
    const view = render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: GREETING }));
    act(() => emitter.emit('transcript', { role: 'user', text: 'open pricing', final: true }));
    expect(captionLines()).toEqual([['bot', GREETING], ['user', 'open pricing']]);
    view.rerender(<VoiceButton client={client} earcon={false} callCaptions={false} />);
    act(() => emitter.emit('transcript', { role: 'bot', text: 'Sure.', final: true }));
    view.rerender(<VoiceButton client={client} earcon={false} />);
    // None of the lines from before, which would show with a hole where the
    // ones said while captions were off would be.
    expect(captionsBox()).toBeNull();
    // The greeting went with them: the agent saying its words is a line of the call.
    act(() => emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    act(() => emitter.emit('transcript', { role: 'user', text: 'and the plans?', final: true }));
    expect(captionLines()).toEqual([['bot', GREETING], ['user', 'and the plans?']]);
  });

  it('takes the old call’s captions down when it is given another client', () => {
    const first = fakeClient();
    const view = render(<VoiceButton client={first.client} earcon={false} />);
    act(() => first.setState('listening'));
    act(() => first.emitter.emit('transcript', { role: 'user', text: 'open pricing', final: true }));
    act(() => first.emitter.emit('transcript', { role: 'bot', text: 'Sure.', final: true }));
    expect(captionLines()).toHaveLength(2);
    const second = fakeClient();
    view.rerender(<VoiceButton client={second.client} earcon={false} />);
    // The new client has no call: none of the old call's lines beside its idle button.
    expect(button().getAttribute('data-state')).toBe('idle');
    expect(captionsBox()).toBeNull();
  });

  it('does not take the old call’s greeting into a call the new client is connecting', () => {
    const first = fakeClient();
    const view = render(<VoiceButton client={first.client} earcon={false} />);
    act(() => first.setState('listening'));
    act(() => first.emitter.emit('callStarted', { voiceModel: 'elevenlabs', greeting: GREETING }));
    expect(captionLines()).toEqual([['bot', GREETING]]);
    const second = fakeClient();
    second.voice.state = 'connecting';
    view.rerender(<VoiceButton client={second.client} earcon={false} />);
    expect(captionsBox()).toBeNull();
    act(() => second.setState('listening'));
    act(() => second.emitter.emit('callStarted', { voiceModel: 'gemini-live', greeting: null }));
    // The new call's first line is its own, though it says the old greeting's words.
    act(() => second.emitter.emit('transcript', { role: 'bot', text: GREETING, final: true }));
    expect(captionLines()).toEqual([['bot', GREETING]]);
  });

  it('keeps errors and approvals above the captions, and announces no caption', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('transcript', { role: 'user', text: 'delete the old files', final: true }));
    act(() => {
      emitter.emit('approvalChange', {
        toolCallId: 'c1',
        toolName: 'delete_files',
        arguments: { count: 3 },
        description: 'Deletes files',
        decide: vi.fn(),
      });
    });
    const follows = (first: Element, second: Element) =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const captions = captionsBox()!;
    expect(follows(screen.getByRole('region', { name: /delete_files/ }), captions)).toBe(true);
    // Under the status, above "Change voice".
    expect(follows(document.querySelector('.t2v-voice-status')!, captions)).toBe(true);
    expect(follows(captions, screen.getByRole('link', { name: 'Change voice' }))).toBe(true);
    // The call speaks each line, so none is sent to a screen reader as it
    // comes, but the lines are not hidden from one either.
    expect(captions.hasAttribute('aria-live')).toBe(false);
    expect(captions.hasAttribute('aria-hidden')).toBe(false);
    for (const region of liveRegions()) expect(region.textContent).not.toContain('delete the old files');
    act(() => emitter.emit('error', { type: 'transport_error', message: 'HTTP 503' }));
    expect(follows(screen.getByRole('alert'), captionsBox()!)).toBe(true);
    for (const region of liveRegions()) expect(region.textContent).not.toContain('delete the old files');
  });

  it('shows the note for the first seconds of a call', () => {
    vi.useFakeTimers();
    try {
      const { client, emitter, setState } = fakeClient();
      render(<VoiceButton client={client} earcon={false} />);
      act(() => emitter.emit('note', NOTE));
      expect(note()?.textContent).toBe(NOTE); // a note alone opens the popover
      act(() => setState('listening'));
      expect(note()?.textContent).toBe(NOTE);
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(note()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the note through a slow connect, and counts its six seconds from when the call is live', () => {
    vi.useFakeTimers();
    try {
      const { client, emitter, setState } = fakeClient();
      render(<VoiceButton client={client} earcon={false} />);
      act(() => setState('connecting'));
      // The engine's note arrives with the mint, before the microphone and the connect.
      act(() => emitter.emit('note', NOTE));
      expect(note()?.textContent).toBe(NOTE);
      act(() => {
        vi.advanceTimersByTime(20_000);
      });
      expect(note()?.textContent).toBe(NOTE);
      act(() => setState('listening'));
      act(() => {
        vi.advanceTimersByTime(5999);
      });
      expect(note()?.textContent).toBe(NOTE);
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(note()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the note of a call that fell back, in place of the one before it', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('connecting'));
    act(() => emitter.emit('note', NOTE));
    act(() => emitter.emit('note', 'Using Gemini Live — ElevenLabs couldn’t connect.'));
    expect(document.querySelectorAll('.t2v-voice-note')).toHaveLength(1);
    expect(note()?.textContent).toBe('Using Gemini Live — ElevenLabs couldn’t connect.');
  });

  it('drops the note when an error follows it before the call is up', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('connecting'));
    // The note fires before the token, the microphone and the connect: a start
    // that then fails must not go on showing it beside the error.
    act(() => emitter.emit('note', NOTE));
    expect(note()?.textContent).toBe(NOTE);
    act(() => emitter.emit('error', { type: 'transport_error', message: 'HTTP 503' }));
    expect(note()).toBeNull();
    // The alert speaks for the failure; neither live region goes on reading anything out.
    expect(noteAnnouncement()).toBe('');
    expect(statusText()).toBe('');
    act(() => setState('error'));
    expect(note()).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('The call couldn’t connect');
  });

  it('drops the note when the call is hung up before it connects', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('connecting'));
    act(() => emitter.emit('note', NOTE));
    expect(note()?.textContent).toBe(NOTE);
    act(() => {
      setState('ended');
      emitter.emit('ended', 'stopped');
    });
    expect(note()).toBeNull();
    expect(noteAnnouncement()).toBe('');
  });

  it('reads the note out once, from a live region of its own', () => {
    vi.useFakeTimers();
    try {
      const { client, emitter, setState } = fakeClient();
      render(<VoiceButton client={client} earcon={false} />);
      // Both regions are in the DOM before anything is said: a live region that
      // appears together with its text is often not announced.
      expect(liveRegions()).toHaveLength(2);
      expect(statusText()).toBe('');
      expect(noteAnnouncement()).toBe('');

      act(() => setState('connecting'));
      act(() => emitter.emit('note', NOTE));
      // The status says what it said before the note came: it is not read again with it.
      expect(statusText()).toBe('Connecting…');
      expect(noteAnnouncement()).toBe(NOTE);
      // The visible copy is hidden from screen readers, as the status pill is.
      expect(note()?.getAttribute('aria-hidden')).toBe('true');

      act(() => setState('listening'));
      expect(statusText()).toBe('Say hello!');
      expect(noteAnnouncement()).toBe(NOTE); // not changed, so not read again

      // The note going is not announced (an empty region says nothing), and it
      // does not make the status read out again either.
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(note()).toBeNull();
      expect(noteAnnouncement()).toBe('');
      expect(statusText()).toBe('Say hello!');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the note out of the status region, whatever the call is doing', () => {
    vi.useFakeTimers();
    try {
      const { client, emitter, setState } = fakeClient();
      render(<VoiceButton client={client} earcon={false} />);
      // With the note up, the status reads as it does on a call with no note.
      const statusIs = (expected: string) => {
        expect(statusText()).toBe(expected);
        expect(statusText()).not.toContain(NOTE);
      };
      act(() => setState('connecting'));
      act(() => emitter.emit('note', NOTE));
      statusIs('Connecting…');
      act(() => setState('listening'));
      statusIs('Say hello!');
      act(() => emitter.emit('transcript', { role: 'user', text: 'hi', final: false }));
      statusIs('Listening');
      act(() => emitter.emit('agentState', 'working'));
      statusIs('Working…');
      act(() => emitter.emit('agentState', 'idle'));
      statusIs('Listening');
      expect(note()?.textContent).toBe(NOTE); // still up through all of it
      act(() => {
        vi.advanceTimersByTime(6000);
      });
      expect(note()).toBeNull();
      statusIs('Listening');
      act(() => {
        setState('ended');
        emitter.emit('ended', 'disconnected');
      });
      statusIs('The call dropped.');
    } finally {
      vi.useRealTimers();
    }
  });

  it('change voice link only for signed-in non-guests', () => {
    const signedIn = fakeClient();
    const view = render(<VoiceButton client={signedIn.client} earcon={false} />);
    act(() => signedIn.setState('listening'));
    const link = screen.getByRole('link', { name: 'Change voice' }) as HTMLAnchorElement;
    expect(link.href).toBe(VOICE_PREFERENCE_URL);
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noopener noreferrer');
    view.unmount();

    // An anonymous user has an account to make first, and a signed-out visitor has none.
    for (const auth of [{ isAnonymous: () => true }, { isAuthenticated: () => false }]) {
      const { client, setState } = fakeClient(auth);
      const other = render(<VoiceButton client={client} earcon={false} />);
      act(() => setState('listening'));
      expect(screen.queryByRole('link')).toBeNull();
      other.unmount();
    }
    // A client without an auth object (a partner's own stand-in) shows no link either.
    const bare = fakeClient();
    (bare.client as unknown as { auth?: unknown }).auth = undefined;
    render(<VoiceButton client={bare.client} earcon={false} />);
    act(() => bare.setState('listening'));
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows Change voice for the length of the call, and not before or after it', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    expect(screen.queryByRole('link')).toBeNull();
    act(() => setState('connecting'));
    expect(screen.queryByRole('link', { name: 'Change voice' })).not.toBeNull();
    act(() => setState('listening'));
    expect(screen.queryByRole('link', { name: 'Change voice' })).not.toBeNull();
    // The popover is still up after a dropped call, saying so: the call is over,
    // and so is the chance to change its voice.
    act(() => {
      setState('ended');
      emitter.emit('ended', 'disconnected');
    });
    expect(statusText()).toBe('The call dropped.');
    expect(document.querySelector('.t2v-voice-popover')).not.toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the agent working', () => {
    const { client, emitter, setState } = fakeClient();
    render(<VoiceButton client={client} earcon={false} />);
    act(() => setState('listening'));
    act(() => emitter.emit('agentState', 'working'));
    expect(button().getAttribute('data-busy')).toBe('true');
    expect(statusText()).toBe('Working…');
    act(() => emitter.emit('agentState', 'idle'));
    expect(button().getAttribute('data-busy')).toBeNull();
    expect(statusText()).toBe('Listening');
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
      expect(statusText()).toBe('The call reached its time limit.');
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(statusText()).toBe('');
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
      sessionFor: vi.fn(),
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

  it('tells a guest out of credit to sign in, and a signed-in user to upgrade', () => {
    expect(voiceErrorMessage({ type: 'insufficient_credit', message: 'x' }, { anonymous: true })).toBe(
      'You’ve used your free credits. Sign in or create an account to keep going.',
    );
    expect(voiceErrorMessage({ type: 'insufficient_credit', message: 'x' })).toBe(
      'You’re out of credits. Upgrade your plan to keep going.',
    );
  });

  it('shows the guest wording when a guest runs out mid-call', () => {
    const { client, emitter } = fakeClient();
    (client as unknown as { auth: { isAnonymous: () => boolean } }).auth = { isAnonymous: () => true };
    render(<VoiceButton client={client} earcon={false} />);
    act(() => emitter.emit('error', { type: 'insufficient_credit', message: 'x' }));
    expect(screen.getByRole('alert').textContent).toContain('Sign in or create an account');
  });

  it('tells the end-user to allow the microphone when it is unavailable', () => {
    expect(voiceErrorMessage({ type: 'mic_unavailable', message: 'raw' })).toBe(
      'Voice needs microphone access. Allow the microphone and try again.',
    );
  });

  it('names the no-voice case', () => {
    expect(voiceErrorMessage({ type: 'voice_model_unavailable', message: 'x' })).toBe(
      'Voice isn’t available right now.',
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

  it("starts the call with the chat's systemPrompt, so voice turns get the page instructions", async () => {
    const client = new Talk2View({ partnerKey: 'pk_test_x' });
    vi.spyOn(client, 'getConfig').mockResolvedValue({ voice_agent_enabled: true } as PartnerConfig);
    const start = vi.spyOn(client.voice, 'start').mockResolvedValue();
    render(<Talk2ViewChatLauncher client={client} systemPrompt="Update the study list table." />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(voiceButton()!);
    });
    expect(start).toHaveBeenCalledWith({ systemPrompt: 'Update the study list table.' });
  });

  it('is not there when the integrator turns it off', async () => {
    await mountLauncher({ voice_agent_enabled: true }, { voice: false });
    expect(voiceButton()).toBeNull();
  });

  const mark = () => document.querySelector('.aui-modal-button');

  it('arrives with the mark, not a beat after it', async () => {
    const client = new Talk2View({ partnerKey: 'pk_test_x' });
    let answer!: (c: PartnerConfig) => void;
    vi.spyOn(client, 'getConfig').mockReturnValue(new Promise((r) => (answer = r)));
    render(<Talk2ViewChatLauncher client={client} />);
    await act(async () => {});
    // Config still out: neither is drawn, so voice cannot pop in after the mark.
    expect(mark()).toBeNull();
    expect(voiceButton()).toBeNull();
    await act(async () => answer({ voice_agent_enabled: true } as PartnerConfig));
    expect(mark()).not.toBeNull();
    expect(voiceButton()).not.toBeNull();
  });

  it('shows the mark alone when the config request fails', async () => {
    const client = new Talk2View({ partnerKey: 'pk_test_x' });
    vi.spyOn(client, 'getConfig').mockRejectedValue(new Error('network'));
    render(<Talk2ViewChatLauncher client={client} />);
    await act(async () => {});
    expect(mark()).not.toBeNull();
    expect(voiceButton()).toBeNull();
  });

  it('never waits longer than CONFIG_WAIT_MS for a config that does not answer', async () => {
    vi.useFakeTimers();
    try {
      const client = new Talk2View({ partnerKey: 'pk_test_x' });
      vi.spyOn(client, 'getConfig').mockReturnValue(new Promise(() => {}));
      render(<Talk2ViewChatLauncher client={client} />);
      await act(async () => {});
      expect(mark()).toBeNull();
      await act(async () => {
        vi.advanceTimersByTime(CONFIG_WAIT_MS);
      });
      expect(mark()).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait on config at all when the integrator turns voice off', async () => {
    const client = new Talk2View({ partnerKey: 'pk_test_x' });
    vi.spyOn(client, 'getConfig').mockReturnValue(new Promise(() => {}));
    render(<Talk2ViewChatLauncher client={client} features={{ voice: false }} />);
    await act(async () => {});
    expect(mark()).not.toBeNull();
  });
});
