import { expect, it } from 'vitest';

// Deliberately does not import ./widget: only the naming convention links them.
it('widget placeholder', () => expect(1).toBe(1));
