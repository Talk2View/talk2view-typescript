/**
 * SettingsPanel — full-panel settings page for user preferences.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Model, UserPreferences } from '../../types';
import { useTalk2View } from '../context';
import { useUserPreferences } from '../../react/useUserPreferences';
import { usePartnerConfig } from '../../react/usePartnerConfig';
import { groupModelsByProvider } from '../utils';

export interface SettingsPanelProps {
  onBack?: () => void;
  onModelChange?: (model: string) => void;
  /** Hide the built-in header (use when embedding in a container with its own header). */
  hideHeader?: boolean;
}

const STT_LANGUAGES: { code: string; label: string }[] = [
  { code: '', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
];

const FONT_SIZES: { value: UserPreferences['fontSize']; label: string }[] = [
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: '6px',
  border: '1.5px solid var(--t2v-border)',
  fontSize: '13px',
  fontFamily: 'var(--t2v-font)',
  color: 'var(--t2v-foreground)',
  backgroundColor: 'var(--t2v-bg)',
  outline: 'none',
  cursor: 'pointer',
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239F9AA4' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: '32px',
};

const labelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontFamily: 'var(--t2v-font)',
  fontWeight: 600,
  color: 'var(--t2v-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px',
};

const sectionStyle: React.CSSProperties = {
  padding: '0 16px',
  marginBottom: '20px',
};

export function SettingsPanel({ onBack, onModelChange, hideHeader }: SettingsPanelProps) {
  const { t2v } = useTalk2View();
  const { preferences, updatePreferences } = useUserPreferences();
  const { config: partnerConfig } = usePartnerConfig();
  const [models, setModels] = useState<Model[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [sttModels, setSttModels] = useState<Model[]>([]);
  const [sttModelsLoading, setSttModelsLoading] = useState(true);

  // Fetch available LLM models on mount
  useEffect(() => {
    let cancelled = false;
    setModelsLoading(true);

    const fetchModels = async () => {
      try {
        const res = await t2v.listModels();
        if (!cancelled) setModels(res.data ?? []);
      } catch (err) {
        console.error('Failed to fetch models:', err);
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    };

    fetchModels();
    return () => { cancelled = true; };
  }, [t2v]);

  // Fetch available STT models via the engine (server-side filtering)
  useEffect(() => {
    let cancelled = false;
    setSttModelsLoading(true);

    const fetchSttModels = async () => {
      try {
        const data = await t2v.listAudioModels();
        if (!cancelled) setSttModels(data.data ?? []);
      } catch (err) {
        console.error('Failed to fetch STT models:', err);
      } finally {
        if (!cancelled) setSttModelsLoading(false);
      }
    };

    fetchSttModels();
    return () => { cancelled = true; };
  }, [t2v]);

  const modelGroups = useMemo(() => groupModelsByProvider(models), [models]);

  const currentModel = preferences.model || t2v.config.model || partnerConfig?.default_llm_model || '';
  const currentSttModel = preferences.sttModel || partnerConfig?.default_stt_model || '';
  const currentSttLanguage = preferences.sttLanguage ?? '';
  const currentFontSize = preferences.fontSize || 'medium';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      {!hideHeader && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            backgroundColor: 'var(--t2v-foreground)',
            color: 'var(--t2v-bg)',
          }}
        >
          <button
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: 'none',
              backgroundColor: 'rgba(248, 250, 252, 0.1)',
              color: 'var(--t2v-bg)',
              cursor: 'pointer',
              padding: 0,
              transition: 'background-color 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(248, 250, 252, 0.2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(248, 250, 252, 0.1)'; }}
            aria-label="Back to chat"
          >
            <ArrowLeft size={16} />
          </button>
          <span
            style={{
              fontSize: '15px',
              fontFamily: 'var(--t2v-font)',
              fontWeight: 600,
            }}
          >
            Settings
          </span>
        </div>
      )}

      {/* Settings body */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: '20px' }}>
        {/* Language Model */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Language Model</div>
          {modelsLoading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                fontSize: '13px',
                fontFamily: 'var(--t2v-font)',
                color: 'var(--t2v-muted)',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: '2px solid var(--t2v-accent)',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 't2v-spin 0.6s linear infinite',
                }}
              />
              Loading models...
            </div>
          ) : (
            <select
              value={currentModel}
              onChange={(e) => {
                updatePreferences({ model: e.target.value });
                onModelChange?.(e.target.value);
              }}
              style={selectStyle}
            >
              {!currentModel && <option value="">Select a model</option>}
              {modelGroups.map((group) => (
                <optgroup key={group.key} label={group.title}>
                  {group.models.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
        </div>

        {/* Speech-to-Text Model */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Speech-to-Text Model</div>
          {sttModelsLoading ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 12px',
                fontSize: '13px',
                fontFamily: 'var(--t2v-font)',
                color: 'var(--t2v-muted)',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: '2px solid var(--t2v-accent)',
                  borderTopColor: 'transparent',
                  borderRadius: '50%',
                  animation: 't2v-spin 0.6s linear infinite',
                }}
              />
              Loading models...
            </div>
          ) : (
            <select
              value={currentSttModel}
              onChange={(e) => updatePreferences({ sttModel: e.target.value })}
              style={selectStyle}
            >
              {sttModels.length === 0 && (
                <option value="">No models available</option>
              )}
              {!currentSttModel && sttModels.length > 0 && (
                <option value="">Select a model</option>
              )}
              {sttModels.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
              ))}
            </select>
          )}
        </div>

        {/* Speech-to-Text Language */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Speech-to-Text Language</div>
          <select
            value={currentSttLanguage}
            onChange={(e) => updatePreferences({ sttLanguage: e.target.value })}
            style={selectStyle}
          >
            {STT_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>{lang.label}</option>
            ))}
          </select>
        </div>

        {/* Font Size */}
        <div style={sectionStyle}>
          <div style={labelStyle}>Display</div>
          <div
            style={{
              display: 'flex',
              borderRadius: '8px',
              border: '1.5px solid var(--t2v-border)',
              overflow: 'hidden',
            }}
          >
            {FONT_SIZES.map((fs) => {
              const isActive = currentFontSize === fs.value;
              return (
                <button
                  key={fs.value}
                  onClick={() => updatePreferences({ fontSize: fs.value })}
                  style={{
                    flex: 1,
                    padding: '8px 0',
                    border: 'none',
                    backgroundColor: isActive ? 'var(--t2v-accent)' : 'transparent',
                    color: isActive ? 'var(--t2v-accent-foreground)' : 'var(--t2v-foreground)',
                    fontSize: '13px',
                    fontFamily: 'var(--t2v-font)',
                    fontWeight: isActive ? 600 : 400,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {fs.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
