'use client';

/**
 * The Settings view: which AI model answers (and, for a model that offers a
 * choice, how long it thinks first), which dictation model transcribes
 * what the end-user says, and which language it should expect. (A voice call's
 * voice model, Gemini Live or ElevenLabs, is not chosen here: the end-user sets
 * it on their Profile page.) Choices are stored with the SDK's own preferences,
 * so they carry between a partner's own UI and this chat, and across visits.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import type { AudioModel, Model, PartnerConfig } from '../../types.js';
import { useUserPreferences } from '../../react/useUserPreferences.js';
import { modelPickerState, partnerDefaultChoice, reasoningEffortLabel } from '../../model-choice.js';
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

/* Offered when the dictation model does not restrict its languages (the API
   sends no `supported_languages`). */
const COMMON_LANGUAGES = ['en', 'vi', 'zh', 'ja', 'ko', 'fr', 'de', 'es'];

/* The engine's fallback dictation model — DEFAULT_DICTATION_MODEL in the SDK. */
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

/** The languages to offer for a dictation model, A–Z by name. */
const languagesFor = (model: AudioModel | undefined) =>
  [...new Set(model?.supported_languages?.length ? model.supported_languages : COMMON_LANGUAGES)]
    .map((code) => [code, languageName(code)] as const)
    .sort((x, y) => x[1].localeCompare(y[1]));

const label = (m: Model) => m.name ?? m.id;

/** "Default — <model>", with the default's effort when it has one; "Default" when the model is not listed. */
const defaultModelLabel = (models: Model[], partnerConfig: PartnerConfig | null) => {
  const state = modelPickerState(models, partnerDefaultChoice(partnerConfig));
  const row = state.orphan ? undefined : models.find((m) => m.id === state.modelId);
  if (!row) return 'Default';
  return `Default — ${label(row)}${state.effort ? ` (${reasoningEffortLabel(state.effort)})` : ''}`;
};

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

  // The dictation model actually in use: the visitor's choice, else the
  // partner's default, else the engine's. Its languages are the ones worth
  // offering.
  const voiceItems = voices.state === 'ready' ? voices.items : [];
  const defaultSttId = partnerConfig?.default_stt_model || FALLBACK_STT_MODEL;
  const activeVoice = voiceItems.find((m) => m.id === (preferences.sttModel || defaultSttId));
  const defaultVoice = voiceItems.find((m) => m.id === partnerConfig?.default_stt_model);
  const languages = languagesFor(activeVoice);
  const language = preferences.sttLanguage ?? '';
  const languageOrphan = language !== '' && !languages.some(([code]) => code === language);
  const voiceName = activeVoice ? label(activeVoice) : 'the dictation model';

  // The stored pick against the catalogue: an old id such as "X-thinking-high"
  // shows as its base row with that effort. Until the list loads (or if it
  // fails), the stored id is shown as it is and no effort is offered.
  const modelsReady = models.state === 'ready';
  const modelItems = modelsReady ? models.items : [];
  const modelState = modelPickerState(modelItems, {
    model: preferences.model,
    reasoningEffort: preferences.reasoningEffort,
  });
  const effort = modelsReady ? modelState.effort : undefined;

  // A stored effort the model no longer offers is never sent, so it is not
  // kept either. Nothing else is written just by opening Settings.
  const staleEffort = modelsReady && modelState.staleEffort;
  useEffect(() => {
    if (staleEffort) updatePreferences({ reasoningEffort: undefined });
  }, [staleEffort, updatePreferences]);

  return (
    <div className="t2v-chat-settings aui-modal-settings bg-popover absolute inset-0 flex flex-col gap-6 overflow-y-auto p-4 text-sm">
      <Picker
        title="AI model"
        help="Answers your next message. Switching keeps this conversation."
        value={modelsReady ? modelState.modelId : (preferences.model ?? '')}
        // The effort belonged to the model being replaced.
        onChange={(model) => updatePreferences({ model: model || undefined, reasoningEffort: undefined })}
        load={models}
        defaultLabel={defaultModelLabel(modelItems, partnerConfig)}
        orphan={modelsReady && modelState.orphan}
      />
      {effort !== undefined ? (
        <Field
          title="Thinking level"
          help={
            modelState.gated.includes(effort)
              ? `${reasoningEffortLabel(effort)} needs a paid plan.`
              : 'How long the model thinks before it answers. Higher is slower.'
          }
        >
          {(id) => (
            <select
              id={id}
              className={selectClass}
              value={effort}
              // Stored with the catalogue's id: an old id becomes (base id, effort) here.
              onChange={(e) => updatePreferences({ model: modelState.modelId, reasoningEffort: e.target.value })}
            >
              {/* Efforts that need a paid plan stay selectable: the SDK does not
                  know the end-user's plan, and the engine decides. */}
              {modelState.efforts.map((option) => (
                <option key={option} value={option}>
                  {reasoningEffortLabel(option)}
                  {modelState.gated.includes(option) ? ' (paid plan)' : ''}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : null}
      <Picker
        title="Dictation model"
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
        defaultLabel={defaultVoice ? `Default — ${label(defaultVoice)}` : 'Default'}
        orphan={
          !!preferences.sttModel && voices.state === 'ready' && !voiceItems.some((m) => m.id === preferences.sttModel)
        }
      />
      <Field
        title="Spoken language"
        help={
          activeVoice?.supported_languages?.length
            ? languages.length === 1
              ? `${voiceName} transcribes ${languages[0]![1]} only.`
              : `The ${languages.length} languages ${voiceName} can transcribe.`
            : 'A hint for the dictation model.'
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
  defaultLabel,
  orphan,
}: {
  title: string;
  help: string;
  value: string;
  onChange: (id: string) => void;
  load: Load<Model[]>;
  /** The empty option's text once the list has loaded. */
  defaultLabel: string;
  /**
   * The saved choice is one the partner no longer offers. It still has to be
   * shown, or the select would silently display something else.
   */
  orphan: boolean;
}) {
  const items = load.state === 'ready' ? load.items : [];

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
