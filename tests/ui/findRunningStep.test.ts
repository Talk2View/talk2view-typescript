import { findRunningStep } from '../../src/ui/components/ChatPanel';
import type { DisplayMessage, ToolStep } from '../../src/types';

function msg(id: string, role: 'user' | 'assistant', steps?: ToolStep[]): DisplayMessage {
  return { id, role, content: '', timestamp: new Date(0), steps };
}

describe('findRunningStep', () => {
  it('returns null when there are no steps', () => {
    expect(findRunningStep([msg('1', 'user'), msg('2', 'assistant')])).toBeNull();
  });

  it('returns null when no step is running', () => {
    const messages = [
      msg('1', 'assistant', [{ name: 'insert_content', status: 'used' }]),
      msg('2', 'assistant', [{ name: 'format_text', status: 'denied' }]),
    ];
    expect(findRunningStep(messages)).toBeNull();
  });

  it('finds the running step and returns its name and args', () => {
    const messages = [
      msg('1', 'assistant', [{ name: 'insert_content', status: 'used' }]),
      msg('2', 'assistant', [
        { name: 'format_text', status: 'running', args: { bold: true } },
      ]),
    ];
    expect(findRunningStep(messages)).toEqual({ name: 'format_text', args: { bold: true } });
  });

  it('prefers the most recent running step', () => {
    const messages = [
      msg('1', 'assistant', [{ name: 'first', status: 'running' }]),
      msg('2', 'assistant', [
        { name: 'second', status: 'used' },
        { name: 'third', status: 'running' },
      ]),
    ];
    expect(findRunningStep(messages)?.name).toBe('third');
  });
});
