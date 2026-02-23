/**
 * SettingsView — full-panel settings page for user preferences.
 */

import React, { useEffect, useState } from 'react';
import { getUserApiKey } from '../storage';
import type { Model, UserPreferences } from '../types';
import { T2V_COLORS, T2V_FONTS } from './theme';
import { useT2V } from './T2VProvider';
import { useUserPreferences } from './useUserPreferences';

/** Known STT model ID prefixes/patterns — used to filter /v1/models results. */
const STT_MODEL_PATTERNS = ['whisper', 'deepgram', 'stt'];

export interface SettingsViewProps {
  onBack: () => void;
  onModelChange?: (model: string) => void;
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
  border: `1.5px solid ${T2V_COLORS.lightGray}`,
  fontSize: '13px',
  fontFamily: T2V_FONTS.body,
  color: T2V_COLORS.dark,
  backgroundColor: '#ffffff',
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
  fontFamily: T2V_FONTS.heading,
  fontWeight: 600,
  color: T2V_COLORS.midGray,
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '6px',
};

const sectionStyle: React.CSSProperties = {
  padding: '0 16px',
  marginBottom: '20px',
};

export function SettingsView({ onBack, onModelChange }: SettingsViewProps) {
  const { t2v } = useT2V();
  const { preferences, updatePreferences } = useUserPreferences();
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
        const client = (t2v as any).client;
        const res: { data: Model[] } = await client.request('/v1/models');
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

  // Fetch available STT models from the voice API
  useEffect(() => {
    let cancelled = false;
    setSttModelsLoading(true);

    const fetchSttModels = async () => {
      try {
        const voiceUrl = t2v.config.voiceApiUrl || t2v.config.baseUrl || 'https://engine.talk2view.com';
        const apiKey = getUserApiKey();
        const headers: Record<string, string> = {};
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const response = await fetch(`${voiceUrl}/v1/models`, { headers });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        const allModels: Model[] = data.data ?? [];
        const filtered = allModels.filter((m) =>
          STT_MODEL_PATTERNS.some((p) => m.id.toLowerCase().includes(p))
        );
        if (!cancelled) setSttModels(filtered);
      } catch (err) {
        console.error('Failed to fetch STT models:', err);
      } finally {
        if (!cancelled) setSttModelsLoading(false);
      }
    };

    fetchSttModels();
    return () => { cancelled = true; };
  }, [t2v]);

  const currentModel = preferences.model || t2v.config.model || '';
  const currentSttModel = preferences.sttModel || 'whisper-1';
  const currentSttLanguage = preferences.sttLanguage ?? '';
  const currentFontSize = preferences.fontSize || 'medium';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          padding: '12px 16px',
          backgroundColor: T2V_COLORS.dark,
          color: T2V_COLORS.light,
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
            color: T2V_COLORS.light,
            cursor: 'pointer',
            padding: 0,
            transition: 'background-color 0.15s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(248, 250, 252, 0.2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(248, 250, 252, 0.1)'; }}
          aria-label="Back to chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span
          style={{
            fontSize: '15px',
            fontFamily: T2V_FONTS.heading,
            fontWeight: 600,
          }}
        >
          Settings
        </span>
      </div>

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
                fontFamily: T2V_FONTS.body,
                color: T2V_COLORS.midGray,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: `2px solid ${T2V_COLORS.turquoise}`,
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
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.id}</option>
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
                fontFamily: T2V_FONTS.body,
                color: T2V_COLORS.midGray,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: `2px solid ${T2V_COLORS.turquoise}`,
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
                <option value="whisper-1">whisper-1</option>
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
              border: `1.5px solid ${T2V_COLORS.lightGray}`,
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
                    backgroundColor: isActive ? T2V_COLORS.turquoise : 'transparent',
                    color: isActive ? '#ffffff' : T2V_COLORS.dark,
                    fontSize: '13px',
                    fontFamily: T2V_FONTS.heading,
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
