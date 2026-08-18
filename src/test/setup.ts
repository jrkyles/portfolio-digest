import '@testing-library/jest-dom/vitest'

// jsdom doesn't implement ResizeObserver. ScaledStage relies on it to learn the stage's
// real width; this stub reports a fixed DESIGN_WIDTH-sized box so tests that mount
// ScaledStage (e.g. App integration tests) get a real, non-zero scale instead of hanging
// at scale=0 forever.
class ResizeObserverStub {
  callback: ResizeObserverCallback
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }
  observe(target: Element) {
    Promise.resolve().then(() => {
      this.callback(
        [{ target, contentRect: { width: 1600, height: 900 } } as ResizeObserverEntry],
        this as unknown as ResizeObserver
      )
    })
  }
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error - test-only stub, doesn't need the full ResizeObserver surface
global.ResizeObserver = ResizeObserverStub
