import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'admin',
    // The components render into jsdom, with React Testing Library.
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
  },
});
