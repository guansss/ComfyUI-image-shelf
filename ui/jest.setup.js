require("@testing-library/jest-dom")

global.fetch = jest.fn()

// Mock window.app for ComfyUI integration testing
global.window.app = {
  graph: {
    _nodes: [],
  },
  api: {
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
  },
  canvas: {
    centerOnNode: jest.fn(),
  },
}
