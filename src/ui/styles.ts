let injected = false;

export function injectComponentStyles(): void {
  if (injected || typeof document === 'undefined') return;
  const id = 't2v-component-styles';
  if (document.getElementById(id)) { injected = true; return; }

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
[data-talk2view], [data-talk2view] * {
  box-sizing: border-box;
}

@keyframes t2v-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes t2v-spin {
  to { transform: rotate(360deg); }
}
@keyframes t2v-dot-bounce {
  0%, 80%, 100% { transform: translateY(0); }
  40% { transform: translateY(-4px); }
}
@keyframes t2v-blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}
@keyframes t2v-shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes t2v-typing {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.8); }
  30% { opacity: 1; transform: scale(1); }
}

[data-talk2view] .t2v-scrollable::-webkit-scrollbar { width: 4px; }
[data-talk2view] .t2v-scrollable::-webkit-scrollbar-thumb {
  background: var(--t2v-border); border-radius: 2px;
}
[data-talk2view] .t2v-scrollable::-webkit-scrollbar-track { background: transparent; }

[data-talk2view] .t2v-focusable:focus-visible {
  outline: 2px solid var(--t2v-accent);
  outline-offset: 2px;
}

[data-talk2view] .t2v-md p { margin: 0 0 0.7em; }
[data-talk2view] .t2v-md p:last-child { margin-bottom: 0; }
[data-talk2view] .t2v-md h1, [data-talk2view] .t2v-md h2, [data-talk2view] .t2v-md h3 {
  margin: 0.8em 0 0.3em; font-weight: 600; line-height: 1.3;
}
[data-talk2view] .t2v-md h1 { font-size: 1.25em; }
[data-talk2view] .t2v-md h2 { font-size: 1.1em; }
[data-talk2view] .t2v-md h3 { font-size: 1em; }
[data-talk2view] .t2v-md ul, [data-talk2view] .t2v-md ol { margin: 0.3em 0; padding-left: 1.3em; }
[data-talk2view] .t2v-md li { margin: 0.2em 0; }
[data-talk2view] .t2v-md code {
  font-family: var(--t2v-font-mono); font-size: 0.88em;
  padding: 0.12em 0.3em; background: var(--t2v-surface-hover); border-radius: 3px;
}
[data-talk2view] .t2v-md pre { margin: 0.5em 0; padding: 0; border-radius: 6px; overflow: hidden; }
[data-talk2view] .t2v-md pre code { display: block; padding: 0.7em 0.9em; background: none; overflow-x: auto; }
[data-talk2view] .t2v-md blockquote {
  margin: 0.5em 0; padding: 0.3em 0.8em;
  border-left: 3px solid var(--t2v-accent); color: var(--t2v-muted);
}
[data-talk2view] .t2v-md strong { font-weight: 600; }
[data-talk2view] .t2v-md a { color: var(--t2v-accent); text-decoration: underline; }
[data-talk2view] .t2v-md table { border-collapse: collapse; width: 100%; margin: 0.5em 0; font-size: 0.92em; }
[data-talk2view] .t2v-md th, [data-talk2view] .t2v-md td {
  border: 1px solid var(--t2v-border); padding: 0.3em 0.5em; text-align: left;
}
[data-talk2view] .t2v-md th { background: var(--t2v-surface); font-weight: 600; }
[data-talk2view] .t2v-md hr { border: none; border-top: 1px solid var(--t2v-border); margin: 0.6em 0; }

[data-talk2view] .shiki { margin: 0; padding: 12px 14px; overflow-x: auto; }
[data-talk2view] .shiki code { font-family: var(--t2v-font-mono); font-size: 13px; }

[data-talk2view] .t2v-btn:hover { filter: brightness(1.05); }
[data-talk2view] .t2v-btn:active { transform: scale(0.98); }
[data-talk2view] .t2v-btn-ghost:hover { background: var(--t2v-surface-hover); }

[data-talk2view] .t2v-composer {
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
[data-talk2view] .t2v-composer:focus-within {
  border-color: var(--t2v-accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--t2v-accent) 20%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  [data-talk2view] *, [data-talk2view] *::before, [data-talk2view] *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
  }
}
`;
  document.head.appendChild(style);
  injected = true;
}
