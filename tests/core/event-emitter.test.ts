import { TypedEventEmitter } from '../../src/event-emitter';

interface TestEvents {
  change: [string];
  count: [number];
  multi: [string, number];
  empty: [];
}

describe('TypedEventEmitter', () => {
  let emitter: TypedEventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new TypedEventEmitter();
  });

  it('calls listener when event is emitted', () => {
    const listener = vi.fn();
    emitter.on('change', listener);
    emitter.emit('change', 'hello');
    expect(listener).toHaveBeenCalledWith('hello');
  });

  it('supports multiple listeners for same event', () => {
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('change', a);
    emitter.on('change', b);
    emitter.emit('change', 'test');
    expect(a).toHaveBeenCalledWith('test');
    expect(b).toHaveBeenCalledWith('test');
  });

  it('returns unsubscribe function', () => {
    const listener = vi.fn();
    const unsub = emitter.on('change', listener);
    emitter.emit('change', 'first');
    unsub();
    emitter.emit('change', 'second');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith('first');
  });

  it('does not throw when emitting with no listeners', () => {
    expect(() => emitter.emit('change', 'orphan')).not.toThrow();
  });

  it('supports events with multiple arguments', () => {
    const listener = vi.fn();
    emitter.on('multi', listener);
    emitter.emit('multi', 'hello', 42);
    expect(listener).toHaveBeenCalledWith('hello', 42);
  });

  it('supports events with no arguments', () => {
    const listener = vi.fn();
    emitter.on('empty', listener);
    emitter.emit('empty');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('removeAllListeners clears all subscriptions', () => {
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('change', a);
    emitter.on('count', b);
    emitter.removeAllListeners();
    emitter.emit('change', 'test');
    emitter.emit('count', 1);
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });
});
