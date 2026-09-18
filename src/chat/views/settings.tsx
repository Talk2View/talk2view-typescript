'use client';

/**
 * The Settings view: which AI model answers, which voice model transcribes
 * dictation, and which language it should expect. Choices are stored with the
 * SDK's own preferences, so they carry between a partner's own UI and this chat,
 * and across visits.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { AudioModel, Model, PartnerConfig } from '../../types.js';
import { useUserPreferences } from '../../react/useUserPreferences.js';
import { useChatContext } from '../provider.js';
import {
  LAUNCHER_COLOURWAYS,
  LAUNCHER_COLOURWAY_LABELS,
  setLauncherColourway,
  useLauncherColourway,
  useLauncherOptions,
  type LauncherColourway,
} from '../lib/launcher-variant.js';

type Load<T> = { state: 'loading' } | { state: 'ready'; items: T } | { state: 'error' };

/* Offered when the voice model does not restrict its languages (the API sends
   no `supported_languages`). */
const COMMON_LANGUAGES = ['en', 'vi', 'zh', 'ja', 'ko', 'fr', 'de', 'es'];

/* The engine's fallback voice model — DEFAULT_DICTATION_MODEL in the SDK. */
const FALLBACK_STT_MODEL = 'faster-whisper-base';

const languageNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

/** "vi" → "Vietnamese". Falls back to the code for anything Intl does not know. */
const languageName = (code: string) => {
  try {
    return languageNames?.of(code) ?? code;
  } catch {
    return code;
  }
};

/** The languages to offer for a voice model, A–Z by name. */
const languagesFor = (model: AudioModel | undefined) =>
  [...new Set(model?.supported_languages?.length ? model.supported_languages : COMMON_LANGUAGES)]
    .map((code) => [code, languageName(code)] as const)
    .sort((x, y) => x[1].localeCompare(y[1]));

const label = (m: Model) => m.name ?? m.id;

export function SettingsView() {
  const { client, config: mountConfig } = useChatContext();
  const launcher = useLauncherOptions();
  const { preferences, updatePreferences } = useUserPreferences();
  const [models, setModels] = useState<Load<Model[]>>({ state: 'loading' });
  const [voices, setVoices] = useState<Load<AudioModel[]>>({ state: 'loading' });
  // A new visitor has no session when the chat mounts, so the provider's config
  // fetch 401s. Listing the models starts the guest session; ask again after.
  const [lateConfig, setLateConfig] = useState<PartnerConfig | null>(null);
  const partnerConfig = mountConfig ?? lateConfig;

  useEffect(() => {
    let live = true;
    client
      .listModels()
      .then((r) => live && setModels({ state: 'ready', items: r.data }))
      .catch(() => live && setModels({ state: 'error' }));
    client
      .listAudioModels()
      .then((r) => live && setVoices({ state: 'ready', items: r.data }))
      .catch(() => live && setVoices({ state: 'error' }))
      .then(() => client.getConfig())
      .then((value) => live && value && setLateConfig(value))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [client]);

  // The voice model actually in use: the visitor's choice, else the partner's
  // default, else the engine's. Its languages are the ones worth offering.
  const voiceItems = voices.state === 'ready' ? voices.items : [];
  const defaultSttId = partnerConfig?.default_stt_model || FALLBACK_STT_MODEL;
  const activeVoice = voiceItems.find((m) => m.id === (preferences.sttModel || defaultSttId));
  const languages = languagesFor(activeVoice);
  const language = preferences.sttLanguage ?? '';
  const languageOrphan = language !== '' && !languages.some(([code]) => code === language);
  const voiceName = activeVoice ? label(activeVoice) : 'the voice model';

  return (
    <div className="t2v-chat-settings aui-modal-settings bg-popover absolute inset-0 flex flex-col gap-6 overflow-y-auto p-4 text-sm">
      <Picker
        title="AI model"
        help="Answers your next message. Switching keeps this conversation."
        value={preferences.model ?? ''}
        onChange={(model) => updatePreferences({ model: model || undefined })}
        load={models}
        defaultId={partnerConfig?.default_llm_model}
      />
      <Picker
        title="Voice model"
        help="Transcribes what you say when you use the mic."
        value={preferences.sttModel ?? ''}
        onChange={(sttModel) => {
          // A language the new model cannot transcribe goes back to auto-detect.
          const next = voiceItems.find((m) => m.id === (sttModel || defaultSttId));
          const keep = !language || languagesFor(next).some(([code]) => code === language);
          updatePreferences({
            sttModel: sttModel || undefined,
            ...(keep ? {} : { sttLanguage: undefined }),
          });
        }}
        load={voices}
        defaultId={partnerConfig?.default_stt_model}
      />
      <Field
        title="Spoken language"
        help={
          activeVoice?.supported_languages?.length
            ? languages.length === 1
              ? `${voiceName} transcribes ${languages[0]![1]} only.`
              : `The ${languages.length} languages ${voiceName} can transcribe.`
            : 'A hint for the voice model.'
        }
      >
        {(id) => (
          <select
            id={id}
            className={selectClass}
            value={language}
            onChange={(e) => updatePreferences({ sttLanguage: e.target.value || undefined })}
          >
            <option value="">Detect automatically</option>
            {languageOrphan ? (
              <option value={language}>
                {languageName(language)} (not supported by {voiceName})
              </option>
            ) : null}
            {languages.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        )}
      </Field>
      {/* Last, and only when the launcher offers the choice: it is about the
          page the chat sits on, not about the conversation. */}
      {launcher.visitorColourway && <ColourwayField fallback={launcher.colourway} />}
    </div>
  );
}

/** The launcher's colour, when the integrator lets the visitor pick it. */
function ColourwayField({ fallback }: { fallback: LauncherColourway }) {
  const colourway = useLauncherColourway(fallback, true);
  return (
    <Field title="Launcher colour" help="The floating button. Remembered on this device.">
      {(id) => (
        <select
          id={id}
          className={selectClass}
          value={colourway}
          onChange={(e) => setLauncherColourway(e.target.value as LauncherColourway)}
        >
          {LAUNCHER_COLOURWAYS.map((option) => (
            <option key={option} value={option}>
              {LAUNCHER_COLOURWAY_LABELS[option]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

const selectClass =
  'border-input bg-background text-foreground focus-visible:ring-ring h-9 w-full border px-2.5 text-sm outline-none focus-visible:ring-2 disabled:opacity-60';

function Field({
  title,
  help,
  children,
}: {
  title: string;
  help: string;
  children: (id: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="font-medium">
        {title}
      </label>
      {children(id)}
      <p className="text-muted-foreground text-xs">{help}</p>
    </div>
  );
}

function Picker({
  title,
  help,
  value,
  onChange,
  load,
  defaultId,
}: {
  title: string;
  help: string;
  value: string;
  onChange: (id: string) => void;
  load: Load<Model[]>;
  defaultId?: string | null;
}) {
  const items = load.state === 'ready' ? load.items : [];
  const defaultModel = items.find((m) => m.id === defaultId);
  const defaultLabel = defaultModel ? `Default — ${label(defaultModel)}` : 'Default';
  // A saved choice the partner no longer offers still has to be shown, or the
  // select would silently display something else.
  const orphan = value && load.state === 'ready' && !items.some((m) => m.id === value);

  return (
    <Field
      title={title}
      help={load.state === 'error' ? 'Couldn’t load the list — the default will be used.' : help}
    >
      {(id) => (
        <select
          id={id}
          className={selectClass}
          value={value}
          disabled={load.state !== 'ready'}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">{load.state === 'loading' ? 'Loading…' : defaultLabel}</option>
          {orphan ? <option value={value}>{value} (no longer offered)</option> : null}
          {items.map((m) => (
            <option key={m.id} value={m.id}>
              {label(m)}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}
